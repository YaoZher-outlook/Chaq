import assert from "node:assert/strict";
import test from "node:test";
import { realtimeSessionToken } from "./realtime-auth";

const token = "a".repeat(43);

test("extracts one valid credential from the negotiated realtime protocols", () => {
  assert.equal(realtimeSessionToken(`chaq-v1, chaq-auth.${token}`), token);
  assert.equal(realtimeSessionToken(["chaq-v1", `chaq-auth.${token}`]), token);
});

test("rejects missing version, malformed tokens, and ambiguous credentials", () => {
  assert.equal(realtimeSessionToken(`chaq-auth.${token}`), null);
  assert.equal(realtimeSessionToken("chaq-v1, chaq-auth.short"), null);
  assert.equal(realtimeSessionToken(`chaq-v1, chaq-auth.${token}, chaq-auth.${"b".repeat(43)}`), null);
  assert.equal(realtimeSessionToken(undefined), null);
});
