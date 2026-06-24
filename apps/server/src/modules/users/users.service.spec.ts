import assert from "node:assert/strict";
import test from "node:test";
import { TokenTransactionKind, UserRole } from "@prisma/client";
import { UsersService } from "./users.service";

test("wallet summary separates model spending, service fees, and per-agent earnings", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "creator-1",
        username: "creator",
        email: null,
        passwordHash: "",
        displayName: "Creator",
        avatarUrl: null,
        role: UserRole.CREATOR,
        tokenBalance: 84,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    },
    tokenTransaction: {
      findMany: async (input: any) => input.select
        ? [
          { amount: 7, metadata: { agentId: "agent-1" } },
          { amount: 3, metadata: { agentId: "agent-1" } }
        ]
        : [{ id: "tx-1", amount: 7, kind: TokenTransactionKind.AGENT_SERVICE_EARNING }],
      aggregate: async (input: any) => {
        const kind = input.where.kind;
        if (!kind) return { _sum: { amount: -26 } };
        if (kind.in) return { _sum: { amount: -18 } };
        if (kind === TokenTransactionKind.AGENT_SERVICE_FEE) return { _sum: { amount: -8 } };
        return { _sum: { amount: 10 } };
      }
    },
    agent: { findMany: async () => [{ id: "agent-1", name: "Mira" }] }
  };

  const summary = await new UsersService(prisma as never, {} as never).walletSummary("creator-1");
  assert.equal(summary.balance, 84);
  assert.equal(summary.totalSpent, 26);
  assert.equal(summary.modelSpent, 18);
  assert.equal(summary.serviceFeesPaid, 8);
  assert.equal(summary.serviceEarnings, 10);
  assert.deepEqual(summary.agentEarnings, [{ agentId: "agent-1", agentName: "Mira", amount: 10, transactionCount: 2 }]);
});

test("recharge is limited to the chen_zy pilot account", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "jiang_yy",
        username: "jiang_yy",
        email: "jy@outlook.com",
        passwordHash: "",
        displayName: "jiang_yy",
        avatarUrl: null,
        role: UserRole.USER,
        tokenBalance: 20_000_000,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    }
  };
  await assert.rejects(
    () => new UsersService(prisma as never, {} as never).rechargeTokens("jiang_yy", { amount: 1, unit: "m" }),
    /only available for chen_zy/
  );
});

test("chen_zy recharge credits wallet and records a recharge transaction", async () => {
  let transactionData: any = null;
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "chen_zy",
        username: "chen_zy",
        email: "yaozher@outlook.com",
        passwordHash: "",
        displayName: "chen_zy",
        avatarUrl: null,
        role: UserRole.USER,
        tokenBalance: 100_000_000,
        createdAt: new Date("2026-06-24T00:00:00Z"),
        updatedAt: new Date()
      })
    },
    $transaction: async (callback: any) => callback({
      user: {
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          id: "chen_zy",
          username: "chen_zy",
          email: "yaozher@outlook.com",
          passwordHash: "",
          displayName: "chen_zy",
          avatarUrl: null,
          role: UserRole.USER,
          tokenBalance: 102_000_000,
          createdAt: new Date("2026-06-24T00:00:00Z"),
          updatedAt: new Date()
        })
      },
      tokenTransaction: {
        create: async ({ data }: any) => {
          transactionData = data;
          return { id: "tx-recharge", ...data, createdAt: new Date() };
        }
      }
    })
  };

  const result = await new UsersService(prisma as never, {} as never).rechargeTokens("chen_zy", { amount: 2, unit: "m" });
  assert.equal(result.user.tokenBalance, 102_000_000);
  assert.equal(transactionData.kind, TokenTransactionKind.RECHARGE);
  assert.equal(transactionData.amount, 2_000_000);
  assert.equal(transactionData.balanceAfter, 102_000_000);
  assert.equal(transactionData.metadata.collectionAccountConfigured, false);
});
