import assert from "node:assert/strict";
import test from "node:test";
import { PendingMessageKey } from "./message-idempotency";

test("reuses a key for an unchanged failed message and clears it after success", () => {
  let sequence = 0;
  const attempts = new PendingMessageKey(() => `attempt-${++sequence}`);
  const first = attempts.begin("conversation-1", " hello ");
  assert.equal(attempts.matches("conversation-1", "hello"), true);
  assert.equal(attempts.begin("conversation-1", "hello"), first);
  attempts.succeeded(first);
  assert.notEqual(attempts.begin("conversation-1", "hello"), first);
});

test("changing content or conversation creates a new key", () => {
  let sequence = 0;
  const attempts = new PendingMessageKey(() => `attempt-${++sequence}`);
  const first = attempts.begin("conversation-1", "hello");
  attempts.contentChanged("conversation-1", "different");
  const second = attempts.begin("conversation-1", "different");
  assert.notEqual(second, first);
  attempts.contentChanged("conversation-2", "different");
  assert.notEqual(attempts.begin("conversation-2", "different"), second);
});
