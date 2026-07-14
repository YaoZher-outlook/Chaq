import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createSmtpReader, sendVerificationEmail } from "./email";

test("SMTP reader preserves a multiline response delivered in one TCP chunk", async () => {
  const socket = new PassThrough();
  const reader = createSmtpReader(socket as never);
  const response = reader.expect([250]);

  socket.write("250-mail.example\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n");

  assert.deepEqual(await response, ["250-mail.example", "250-STARTTLS", "250 AUTH PLAIN"]);
  reader.dispose();
  socket.destroy();
});

test("local preview writes verification mail to the log without SMTP", async (t) => {
  const originalEnv = { ...process.env };
  const originalLog = console.log;
  const messages: string[] = [];
  t.after(() => {
    process.env = originalEnv;
    console.log = originalLog;
  });
  process.env.NODE_ENV = "production";
  process.env.CHAQ_RUNTIME_PROFILE = "local-preview";
  process.env.CHAQ_MAIL_MODE = "log";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  console.log = (message?: unknown) => { messages.push(String(message)); };

  await sendVerificationEmail("preview@example.test", "123456", "register");
  assert.ok(messages.some((message) => message.includes("[mail:preview]") && message.includes("123456")));
});

test("formal production cannot silently fall back to log mail", async (t) => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  process.env.NODE_ENV = "production";
  delete process.env.CHAQ_RUNTIME_PROFILE;
  delete process.env.CHAQ_MAIL_MODE;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;

  await assert.rejects(
    sendVerificationEmail("user@example.test", "654321", "register"),
    /SMTP_HOST and SMTP_FROM are required/
  );
});
