import assert from "node:assert/strict";
import test from "node:test";
import { SkillsService } from "./skills.service";

test("source logs cannot be attached to another user's skill", async () => {
  let sourceCreated = false;
  const prisma = {
    skill: { findFirst: async () => null },
    skillSource: { create: async () => { sourceCreated = true; } }
  };
  const users = { ensureUser: async () => ({ id: "user-1" }) };
  const service = new SkillsService(prisma as never, users as never, {} as never);

  await assert.rejects(
    service.logSource("user-1", {
      skillId: "skill-owned-by-user-2",
      kind: "manual",
      fileName: "messages.json",
      messageCount: 2
    }),
    /Skill not found/
  );
  assert.equal(sourceCreated, false);
});
