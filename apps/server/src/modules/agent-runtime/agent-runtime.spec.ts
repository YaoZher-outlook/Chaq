import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeService } from "./agent-runtime.service";

test("agent runtime compiles its LangGraph topology", () => {
  assert.doesNotThrow(() => new AgentRuntimeService({} as never, {} as never, {} as never));
});

test("user-triggered runs bill the message author while autonomous runs bill the owner", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.equal(runtime.modelPayerUserId({
    run: { trigger: "USER_MESSAGE", triggerPayload: { authorId: "chat-user" } },
    agent: { ownerId: "agent-owner" }
  }), "chat-user");
  assert.equal(runtime.modelPayerUserId({
    run: { trigger: "SCHEDULED", triggerPayload: null },
    agent: { ownerId: "agent-owner" }
  }), "agent-owner");
});

test("HTTP tool config defaults to GET and rejects unsafe methods", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.equal(runtime.httpToolConfig({ url: "https://api.example.com/search" }).method, "GET");
  assert.equal(runtime.httpToolConfig({ url: "https://api.example.com/search", method: "post" }).method, "POST");
  assert.throws(
    () => runtime.httpToolConfig({ url: "https://api.example.com/search", method: "DELETE" }),
    /method must be GET, POST, or HEAD/
  );
});

test("HTTP tool URL guard rejects local and private network targets", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.doesNotThrow(() => runtime.assertAllowedHttpUrl("https://api.example.com/search", {}));
  assert.throws(() => runtime.assertAllowedHttpUrl("http://api.example.com/search", {}), /require HTTPS/);
  assert.throws(() => runtime.assertAllowedHttpUrl("http://127.0.0.1:24537/api", { allowHttp: true }), /local or private/);
  assert.throws(() => runtime.assertAllowedHttpUrl("http://192.168.1.8/api", { allowHttp: true }), /local or private/);
});
