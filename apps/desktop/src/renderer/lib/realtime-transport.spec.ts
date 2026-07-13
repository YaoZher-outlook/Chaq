import assert from "node:assert/strict";
import test from "node:test";
import { realtimeWebSocketProtocols, realtimeWebSocketUrl } from "./realtime-transport";

test("realtime URL contains no session credential or inherited query", () => {
  const token = "a".repeat(43);
  const url = realtimeWebSocketUrl("https://api.example.test/api?token=legacy#fragment");
  assert.equal(url, "wss://api.example.test/api/realtime");
  assert.doesNotMatch(url, new RegExp(token));
  assert.deepEqual(realtimeWebSocketProtocols(token), ["chaq-v1", `chaq-auth.${token}`]);
});

test("invalid realtime tokens are rejected before constructing WebSocket protocols", () => {
  assert.throws(() => realtimeWebSocketProtocols("not a token"), /Invalid realtime/);
});
