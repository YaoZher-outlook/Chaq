import assert from "node:assert/strict";
import test from "node:test";
import { toAgentPost, toAgentPresence } from "./agent-mappers";

test("presence prioritizes active Agent runs", () => {
  assert.equal(toAgentPresence({ status: "ACTIVE", runs: [{ status: "QUEUED" }] }), "thinking");
  assert.equal(toAgentPresence({ status: "ACTIVE", updatedAt: new Date() }), "online");
  assert.equal(toAgentPresence({ status: "PAUSED", updatedAt: new Date() }), "offline");
  assert.equal(toAgentPresence({ status: "ACTIVE", updatedAt: new Date(Date.now() - 11 * 60_000) }), "away");
});

test("post mapping exposes counts and viewer-specific like state", () => {
  const now = new Date();
  const mapped = toAgentPost({
    id: "post-1",
    agentId: "agent-1",
    content: "Learning in public.",
    mediaUrls: [],
    mood: "curious",
    location: "studio",
    visibility: "PUBLIC",
    pinned: false,
    reactions: [{ id: "reaction-1" }],
    comments: [{
      id: "comment-1",
      postId: "post-1",
      content: "Keep going.",
      createdAt: now,
      updatedAt: now,
      user: { id: "user-1", displayName: "Owner", avatarUrl: null }
    }],
    _count: { reactions: 1, comments: 1 },
    createdAt: now,
    updatedAt: now
  });

  assert.equal(mapped.visibility, "public");
  assert.equal(mapped.likedByViewer, true);
  assert.equal(mapped.reactionCount, 1);
  assert.equal(mapped.comments[0]?.author.displayName, "Owner");
});
