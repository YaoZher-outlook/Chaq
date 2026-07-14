import { Socket, createConnection } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";

type MailOptions = {
  to: string;
  subject: string;
  text: string;
};

type SmtpSocket = Socket | TLSSocket;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidPassword(password: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password);
}

export async function sendVerificationEmail(email: string, code: string, purpose: "register" | "bind_email"): Promise<void> {
  const subject = purpose === "register" ? "Chaq 注册验证码" : "Chaq 邮箱绑定验证码";
  const title = purpose === "register" ? "欢迎注册 Chaq" : "确认绑定 Chaq 邮箱";
  const text = [
    title,
    "",
    `验证码：${code}`,
    "",
    "验证码 10 分钟内有效，请勿转发给任何人。",
    "如果不是你本人操作，可以忽略这封邮件。",
    "",
    "Chaq Team"
  ].join("\n");
  await sendMail({ to: email, subject, text });
}

async function sendMail(options: MailOptions): Promise<void> {
  const localPreviewLog = process.env.CHAQ_RUNTIME_PROFILE === "local-preview"
    && process.env.CHAQ_MAIL_MODE === "log";
  if (localPreviewLog) {
    console.log(`[mail:preview] ${options.to} | ${options.subject}\n${options.text}`);
    return;
  }
  if (process.env.CHAQ_MAIL_MODE === "log") {
    throw new Error("Log mail delivery is restricted to the local-preview runtime profile.");
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_HOST and SMTP_FROM are required outside local preview.");
    }
    console.log(`[mail:dev] ${options.to} | ${options.subject}\n${options.text}`);
    return;
  }

  const secure = process.env.SMTP_SECURE === "1" || port === 465;
  let socket: SmtpSocket = secure
    ? tlsConnect({ host, port, servername: host })
    : createConnection({ host, port });
  setSmtpTimeout(socket);

  try {
    const reader = createSmtpReader(socket);
    await reader.expect();
    await writeCommand(socket, reader, `EHLO ${process.env.SMTP_EHLO_HOST || "localhost"}`);

    if (!secure && process.env.SMTP_STARTTLS !== "0") {
      await writeCommand(socket, reader, "STARTTLS");
      reader.dispose();
      socket = tlsConnect({ socket, servername: host });
      setSmtpTimeout(socket);
      const tlsReader = createSmtpReader(socket);
      await writeCommand(socket, tlsReader, `EHLO ${process.env.SMTP_EHLO_HOST || "localhost"}`);
      await authenticate(socket, tlsReader, user, pass);
      await sendMessage(socket, tlsReader, from, options);
      tlsReader.dispose();
      return;
    }

    await authenticate(socket, reader, user, pass);
    await sendMessage(socket, reader, from, options);
    reader.dispose();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function authenticate(socket: SmtpSocket, reader: ReturnType<typeof createSmtpReader>, user?: string, pass?: string): Promise<void> {
  if (!user || !pass) return;
  const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
  await writeCommand(socket, reader, `AUTH PLAIN ${token}`);
}

async function sendMessage(socket: SmtpSocket, reader: ReturnType<typeof createSmtpReader>, from: string, options: MailOptions): Promise<void> {
  await writeCommand(socket, reader, `MAIL FROM:<${from}>`);
  await writeCommand(socket, reader, `RCPT TO:<${options.to}>`);
  await writeCommand(socket, reader, "DATA", [354]);

  const headers = [
    `From: ${from}`,
    `To: ${options.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(options.subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    options.text.replace(/\r?\n\./g, "\n..")
  ].join("\r\n");
  await writeCommand(socket, reader, `${headers}\r\n.`);
  await writeCommand(socket, reader, "QUIT", [221]);
  socket.end();
}

export function createSmtpReader(socket: SmtpSocket) {
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];

  socket.setEncoding("utf8");
  const onData = (chunk: string | Buffer) => {
    buffer += chunk;
    flush();
  };
  const onError = (error: Error) => fail(error);
  const onClose = () => fail(new Error("SMTP connection closed before a complete response was received."));
  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("close", onClose);

  function flush() {
    const complete = buffer.split(/\r?\n/);
    buffer = complete.pop() ?? "";
    for (const line of complete) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line);
      else lines.push(line);
    }
  }

  function fail(error: Error) {
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  }

  function nextLine(): Promise<string> {
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
  }

  async function readResponse(): Promise<string[]> {
    const responseLines: string[] = [];
    while (true) {
      const line = await nextLine();
      responseLines.push(line);
      if (/^\d{3} /.test(line)) return responseLines;
    }
  }

  return {
    async expect(allowed = [220, 221, 235, 250, 354]): Promise<string[]> {
      const lines = await readResponse();
      const code = Number(lines.at(-1)?.slice(0, 3));
      if (!allowed.includes(code)) {
        throw new Error(`SMTP error: ${lines.join(" | ")}`);
      }
      return lines;
    },
    dispose(): void {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    }
  };
}

function setSmtpTimeout(socket: SmtpSocket): void {
  const configured = Number(process.env.SMTP_TIMEOUT_MS ?? 15_000);
  const timeoutMs = Math.min(60_000, Math.max(5_000, Number.isFinite(configured) ? configured : 15_000));
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`SMTP operation timed out after ${timeoutMs}ms.`)));
}

async function writeCommand(socket: SmtpSocket, reader: ReturnType<typeof createSmtpReader>, command: string, allowed?: number[]): Promise<string[]> {
  socket.write(`${command}\r\n`);
  return reader.expect(allowed);
}
