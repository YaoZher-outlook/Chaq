import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createSmtpReader } from "./email";

test("SMTP reader preserves a multiline response delivered in one TCP chunk", async () => {
  const socket = new PassThrough();
  const reader = createSmtpReader(socket as never);
  const response = reader.expect([250]);

  socket.write("250-mail.example\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n");

  assert.deepEqual(await response, ["250-mail.example", "250-STARTTLS", "250 AUTH PLAIN"]);
  reader.dispose();
  socket.destroy();
});
