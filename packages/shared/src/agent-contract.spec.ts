import assert from "node:assert/strict";
import test from "node:test";
import {
  agentDraftSchema,
  agentKnowledgeInputSchema,
  agentPostCommentInputSchema,
  agentPostInputSchema,
  agentRelationshipInputSchema
} from "./schemas";

test("agent draft applies production defaults", () => {
  const parsed = agentDraftSchema.parse({
    name: "Lin",
    handle: "lin-agent",
    persona: "Thoughtful and consistent.",
    tone: "Calm.",
    identity: {}
  });

  assert.equal(parsed.autonomyMode, "copilot");
  assert.equal(parsed.dailyActionBudget, 30);
  assert.equal(parsed.dailyTokenBudget, 5000);
  assert.equal(parsed.serviceFee, 0);
  assert.deepEqual(parsed.identity.traits, []);
  assert.deepEqual(parsed.identity.interests, []);
});

test("agent handle rejects whitespace and non-addressable characters", () => {
  const result = agentDraftSchema.safeParse({
    name: "Lin",
    handle: "林 agent",
    persona: "Thoughtful.",
    tone: "Calm.",
    identity: {}
  });

  assert.equal(result.success, false);
});

test("relationship metrics stay normalized", () => {
  const valid = agentRelationshipInputSchema.safeParse({
    targetKind: "agent",
    targetId: "agent-2",
    targetLabel: "Mira",
    affinity: 0.7,
    trust: 0.8,
    familiarity: 0.3,
    sentiment: 0.4
  });
  const invalid = agentRelationshipInputSchema.safeParse({
    targetKind: "agent",
    targetId: "agent-2",
    targetLabel: "Mira",
    affinity: 2
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test("knowledge notes require content and produce a source kind", () => {
  const parsed = agentKnowledgeInputSchema.parse({ title: "Project notes", content: "A useful fact." });
  assert.equal(parsed.kind, "note");
  assert.equal(agentKnowledgeInputSchema.safeParse({ title: "Empty", content: "" }).success, false);
});

test("profile posts apply social defaults and cap media", () => {
  const parsed = agentPostInputSchema.parse({ content: "A small field note." });
  assert.equal(parsed.visibility, "public");
  assert.deepEqual(parsed.mediaUrls, []);
  assert.equal(agentPostInputSchema.safeParse({ content: "", mediaUrls: [] }).success, false);
  assert.equal(agentPostInputSchema.safeParse({ content: "Too many", mediaUrls: ["1", "2", "3", "4", "5"] }).success, false);
});

test("profile comments reject empty and oversized replies", () => {
  assert.equal(agentPostCommentInputSchema.safeParse({ content: "Glad to hear it." }).success, true);
  assert.equal(agentPostCommentInputSchema.safeParse({ content: "   " }).success, false);
  assert.equal(agentPostCommentInputSchema.safeParse({ content: "x".repeat(1001) }).success, false);
});
