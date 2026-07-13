import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, ReactionTarget, ReactionValue } from "@prisma/client";
import { MarketplaceService } from "./marketplace.service";

const users = { ensureUser: async () => ({ id: "user-1" }) };

test("favorite toggles reconcile the cached count in a serializable transaction", async () => {
  let isolationLevel: unknown;
  let updateData: unknown;
  const tx = {
    marketplaceSkill: {
      findUnique: async () => ({ id: "skill-1" }),
      update: async (input: any) => { updateData = input.data; }
    },
    favorite: {
      findUnique: async () => null,
      create: async () => ({ id: "favorite-1" }),
      count: async () => 7
    }
  };
  const prisma = {
    $transaction: async (action: (client: typeof tx) => Promise<unknown>, options: any) => {
      isolationLevel = options.isolationLevel;
      return action(tx);
    }
  };
  const service = new MarketplaceService(prisma as never, users as never);

  assert.deepEqual(await service.toggleFavorite("user-1", "skill-1"), { favorited: true });
  assert.equal(isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
  assert.deepEqual(updateData, { favorites: 7 });
});

test("reaction changes reconcile both counters from reaction rows", async () => {
  let updateData: unknown;
  const tx = {
    marketplaceSkill: {
      findUnique: async () => ({ id: "skill-1" }),
      update: async (input: any) => {
        updateData = input.data;
        return {
          id: "skill-1", skillId: "source-1", versionId: "version-1", publisherId: "publisher-1",
          name: "Skill", description: "Description", avatarUrl: null, tags: [], upvotes: 4, downvotes: 2,
          favorites: 0, importCount: 0, commentCount: 0, createdAt: new Date(), updatedAt: new Date()
        };
      }
    },
    comment: { findUnique: async () => null },
    reaction: {
      findUnique: async () => ({ id: "reaction-1", value: ReactionValue.UP }),
      update: async () => ({ id: "reaction-1" }),
      count: async (input: any) => input.where.value === ReactionValue.UP ? 4 : 2
    }
  };
  const prisma = {
    $transaction: async (action: (client: typeof tx) => Promise<unknown>) => action(tx),
    marketplaceSkill: {
      findUnique: async () => ({
        id: "skill-1", skillId: "source-1", versionId: "version-1", publisherId: "publisher-1",
        name: "Skill", description: "Description", avatarUrl: null, tags: [], upvotes: 4, downvotes: 2,
        favorites: 0, importCount: 0, commentCount: 0, createdAt: new Date(), updatedAt: new Date()
      })
    }
  };
  const service = new MarketplaceService(prisma as never, users as never);

  await service.reactToSkill("user-1", "skill-1", "down");
  assert.deepEqual(updateData, { upvotes: 4, downvotes: 2 });
  assert.equal(ReactionTarget.SKILL, "SKILL");
});
