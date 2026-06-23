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
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !from) {
    console.log(`[mail:dev] ${options.to} | ${options.subject}\n${options.text}`);
    return;
  }

  const secure = process.env.SMTP_SECURE === "1" || port === 465;
  let socket: SmtpSocket = secure
    ? tlsConnect({ host, port, servername: host })
    : createConnection({ host, port });

  const reader = createSmtpReader(socket);
  await reader.expect();
  await writeCommand(socket, reader, `EHLO ${process.env.SMTP_EHLO_HOST || "localhost"}`);

  if (!secure && process.env.SMTP_STARTTLS !== "0") {
    await writeCommand(socket, reader, "STARTTLS");
    socket = tlsConnect({ socket, servername: host });
    const tlsReader = createSmtpReader(socket);
    await writeCommand(socket, tlsReader, `EHLO ${process.env.SMTP_EHLO_HOST || "localhost"}`);
    await authenticate(socket, tlsReader, user, pass);
    await sendMessage(socket, tlsReader, from, options);
    return;
  }

  await authenticate(socket, reader, user, pass);
  await sendMessage(socket, reader, from, options);
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

function createSmtpReader(socket: SmtpSocket) {
  let buffer = "";
  const waiters: Array<(line: string) => void> = [];

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    flush();
  });

  function flush() {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
    }
  }

  async function readResponse(): Promise<string[]> {
    const lines: string[] = [];
    while (true) {
      const line = await new Promise<string>((resolve) => waiters.push(resolve));
      lines.push(line);
      if (/^\d{3} /.test(line)) return lines;
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
    }
  };
}

async function writeCommand(socket: SmtpSocket, reader: ReturnType<typeof createSmtpReader>, command: string, allowed?: number[]): Promise<string[]> {
  socket.write(`${command}\r\n`);
  return reader.expect(allowed);
}
