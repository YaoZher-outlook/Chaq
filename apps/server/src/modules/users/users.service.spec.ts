import assert from "node:assert/strict";
import test from "node:test";
import { RechargeOrderStatus, TokenTransactionKind, UserRole } from "@prisma/client";
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
    () => new UsersService(prisma as never, {} as never).createRechargeOrder("jiang_yy", { amount: 1, unit: "m" }),
    /only available for chen_zy/
  );
});

test("chen_zy recharge creates a pending bank transfer order without crediting tokens", async () => {
  process.env.PAYMENT_ACCOUNT_NUMBER = "6214000011116181";
  process.env.PAYMENT_BANK_NAME = "Test Bank";
  process.env.PAYMENT_ACCOUNT_NAME = "Test Payee";
  process.env.PAYMENT_CNY_PER_M_TOKEN = "2";
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
    rechargeOrder: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => ({
        id: "order-1",
        status: RechargeOrderStatus.PENDING,
        adminNote: "",
        paidTransactionId: null,
        submittedAt: null,
        reviewedAt: null,
        createdAt: new Date("2026-06-24T00:00:00Z"),
        updatedAt: new Date("2026-06-24T00:00:00Z"),
        ...data
      })
    }
  };
  const rateLimit = { consume: async () => ({ allowed: true, limit: 6, remaining: 5, retryAfterSeconds: 0 }) };

  const result = await new UsersService(prisma as never, rateLimit as never).createRechargeOrder("chen_zy", { amount: 2, unit: "m" });
  assert.equal(result.amountTokens, 2_000_000);
  assert.equal(result.payableCny, 4);
  assert.equal(result.status, "pending");
  assert.equal(result.paymentAccount.accountNumber, "6214000011116181");
});

test("admin confirmation credits a recharge order exactly once", async () => {
  process.env.PAYMENT_ACCOUNT_NUMBER = "6214000011116181";
  let transactionData: any = null;
  const order = {
    id: "order-1",
    orderNo: "CHQ20260624ABCD",
    userId: "chen_zy",
    status: RechargeOrderStatus.SUBMITTED,
    amountTokens: 2_000_000,
    requestedAmount: 2,
    requestedUnit: "m",
    payableCny: 2,
    paymentMethod: "bank_transfer",
    paymentReference: "CHQ-ABCD1234",
    payerNote: "paid",
    adminNote: "",
    paidTransactionId: null,
    submittedAt: new Date("2026-06-24T00:00:00Z"),
    reviewedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date("2026-06-24T00:00:00Z"),
    updatedAt: new Date("2026-06-24T00:00:00Z")
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "admin-local",
        username: "admin",
        email: null,
        passwordHash: "",
        displayName: "Admin",
        avatarUrl: null,
        role: UserRole.ADMIN,
        tokenBalance: 9999,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    },
    rechargeOrder: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback: any) => callback({
      rechargeOrder: {
        findUnique: async () => order,
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: any) => ({ ...order, status: RechargeOrderStatus.PAID, ...data, reviewedAt: new Date() })
      },
      user: {
        update: async () => ({ tokenBalance: 102_000_000 })
      },
      tokenTransaction: {
        create: async ({ data }: any) => {
          transactionData = data;
          return { id: "tx-recharge", ...data, createdAt: new Date() };
        }
      }
    })
  };

  const result = await new UsersService(prisma as never, {} as never).moderateRechargeOrder("admin-local", "order-1", "confirm");
  assert.equal(result.status, "paid");
  assert.equal(transactionData.kind, TokenTransactionKind.RECHARGE);
  assert.equal(transactionData.amount, 2_000_000);
  assert.equal(transactionData.balanceAfter, 102_000_000);
  assert.equal(transactionData.metadata.rechargeOrderId, "order-1");
});
