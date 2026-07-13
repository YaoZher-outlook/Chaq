import assert from "node:assert/strict";
import test from "node:test";
import { LatestRequestGate, isSupersededRequest } from "./latest-request";

test("only the latest request generation can commit", () => {
  const gate = new LatestRequestGate();
  const first = gate.begin();
  assert.equal(gate.isCurrent(first), true);
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.snapshot(), second);
});

test("resource requests abort the previous generation and validate identity", () => {
  const gate = new LatestRequestGate();
  const first = gate.begin("conversation:first");
  const second = gate.begin("conversation:second");

  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.isCurrent(second, "conversation:first"), false);
  assert.equal(gate.isCurrent(second, "conversation:second"), true);

  gate.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(gate.isCurrent(second), false);
});

test("guard rejects an in-flight result as soon as its resource is superseded", async () => {
  const gate = new LatestRequestGate();
  const request = gate.begin("skill:first");
  let resolveOperation!: (value: string) => void;
  const operation = new Promise<string>((resolve) => {
    resolveOperation = resolve;
  });
  const guarded = gate.guard(request, operation);

  gate.begin("skill:second");
  await assert.rejects(guarded, (error) => isSupersededRequest(error));

  // Some transports cannot consume an AbortSignal. Their eventual result is
  // still observed by the guard and discarded instead of becoming unhandled.
  resolveOperation("stale");
});
