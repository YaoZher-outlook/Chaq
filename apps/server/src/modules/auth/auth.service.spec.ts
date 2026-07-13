import assert from "node:assert/strict";
import test from "node:test";
import { hashSessionToken } from "../../common/password";
import { AuthService } from "./auth.service";

const allowedRateLimit = {
  consume: async () => ({ allowed: true, limit: 10, remaining: 9, retryAfterSeconds: 0 })
};
const sessionRevocations = {
  publish: () => undefined,
  subscribe: () => () => undefined
};

test("register-code requests do not reveal an already registered email", async () => {
  let codeCreated = false;
  const prisma = {
    user: { findFirst: async () => ({ id: "existing-user" }) },
    emailVerificationCode: {
      create: async () => {
        codeCreated = true;
      }
    }
  };
  const service = new AuthService(prisma as never, allowedRateLimit as never, sessionRevocations as never);

  assert.deepEqual(await service.requestRegisterCode("Existing@Example.com"), { ok: true });
  assert.equal(codeCreated, false);
});

test("verification code consumption is a compare-and-set operation", async () => {
  const code = "123456";
  const prisma = {
    emailVerificationCode: {
      findFirst: async () => ({ id: "code-1", codeHash: hashSessionToken(code) }),
      updateMany: async () => ({ count: 0 })
    }
  };
  const service = new AuthService(prisma as never, allowedRateLimit as never, sessionRevocations as never) as any;

  await assert.rejects(service.consumeCode("user@example.com", "register", code), /验证码/);
});

test("registration validates the one-time code before looking up account existence", async () => {
  let userLookupCount = 0;
  const prisma = {
    user: {
      findFirst: async () => {
        userLookupCount += 1;
        return { id: "existing-user" };
      }
    },
    emailVerificationCode: { findFirst: async () => null }
  };
  const service = new AuthService(prisma as never, allowedRateLimit as never, sessionRevocations as never);

  await assert.rejects(service.register({
    email: "existing@example.com",
    password: "valid-password-123",
    confirmPassword: "valid-password-123",
    code: "000000"
  }), /验证码/);
  assert.equal(userLookupCount, 0);
});

test("unknown accounts are rejected without creating a session", async () => {
  let sessionCreated = false;
  const prisma = {
    user: { findFirst: async () => null },
    authSession: { create: async () => { sessionCreated = true; } }
  };
  const service = new AuthService(prisma as never, allowedRateLimit as never, sessionRevocations as never);

  await assert.rejects(service.login("missing@example.com", "not-the-password"));
  assert.equal(sessionCreated, false);
});

test("logout revokes the database session and publishes its token hash", async () => {
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const prisma = {
    authSession: {
      updateMany: async (input: unknown) => {
        updates.push(input);
        return { count: 1 };
      }
    }
  };
  const revocations = {
    publish: (event: unknown) => events.push(event),
    subscribe: () => () => undefined
  };
  const service = new AuthService(prisma as never, allowedRateLimit as never, revocations as never);

  assert.deepEqual(await service.logout("session-token"), { ok: true });
  const tokenHash = hashSessionToken("session-token");
  assert.deepEqual(updates, [{
    where: { tokenHash },
    data: { status: "REVOKED" }
  }]);
  assert.deepEqual(events, [{ tokenHash }]);
});
