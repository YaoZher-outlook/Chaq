import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeService } from "./agent-runtime.service";

test("agent runtime compiles its LangGraph topology", () => {
  assert.doesNotThrow(() => new AgentRuntimeService({} as never, {} as never, {} as never));
});
