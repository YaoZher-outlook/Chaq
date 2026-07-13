import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { SessionRevocationEvent, SessionRevocationListener } from "./session-revocation";
import { RealtimeService } from "./realtime.service";

const allowed = { allowed: true, limit: 100, remaining: 99, retryAfterSeconds: 0 };

class FakeSocket extends EventEmitter {
  readonly writes: Array<string | Buffer> = [];
  remoteAddress = "203.0.113.10";
  destroyed = false;
  writable = true;
  writableLength = 0;
  writeReturns = true;

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return this.writeReturns;
  }

  destroy(): this {
    this.destroyed = true;
    this.writable = false;
    return this;
  }

  setNoDelay(): this {
    return this;
  }
}

class FakeRevocationBus {
  private listener?: SessionRevocationListener;

  publish(event: SessionRevocationEvent): void {
    this.listener?.(event);
  }

  subscribe(listener: SessionRevocationListener): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }
}

function session(userId: string, sessionId: string, tokenHash: string) {
  return {
    sessionId,
    tokenHash,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: userId }
  };
}

async function upgrade(
  service: RealtimeService,
  socket: FakeSocket,
  auth: { authenticateSession: (token: string) => Promise<ReturnType<typeof session> | null> },
  token: string
): Promise<void> {
  await (service as any).handleUpgrade(
    "/api/realtime",
    {
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-protocol": `chaq-v1, chaq-auth.${token}`
    },
    socket,
    auth
  );
}

function responseText(socket: FakeSocket): string {
  return socket.writes.map((value) => Buffer.isBuffer(value) ? value.toString("utf8") : value).join("");
}

test("a revoked session is disconnected without affecting another session for the same user", async () => {
  const bus = new FakeRevocationBus();
  const rateLimit = { consume: async () => allowed };
  const service = new RealtimeService(rateLimit as never, bus as never);
  const firstToken = "a".repeat(43);
  const secondToken = "b".repeat(43);
  const auth = {
    authenticateSession: async (token: string) => token === firstToken
      ? session("user-1", "session-1", "hash-1")
      : session("user-1", "session-2", "hash-2")
  };
  const first = new FakeSocket();
  const second = new FakeSocket();

  await upgrade(service, first, auth, firstToken);
  await upgrade(service, second, auth, secondToken);
  assert.equal(first.destroyed, false);
  assert.equal(second.destroyed, false);

  bus.publish({ tokenHash: "hash-1" });
  assert.equal(first.destroyed, true);
  assert.equal(second.destroyed, false);
  const secondWriteCount = second.writes.length;
  service.emitToUser("user-1", "private.event", { secret: true });
  assert.equal(first.writes.length, 2);
  assert.equal(second.writes.length, secondWriteCount + 1);
  service.onModuleDestroy();
});

test("a logout racing an in-flight upgrade leaves a tombstone and rejects the socket", async () => {
  const bus = new FakeRevocationBus();
  const service = new RealtimeService({ consume: async () => allowed } as never, bus as never);
  const token = "c".repeat(43);
  let releaseAuthentication!: () => void;
  const authenticationGate = new Promise<void>((resolve) => { releaseAuthentication = resolve; });
  const auth = {
    authenticateSession: async () => {
      await authenticationGate;
      return session("user-1", "session-race", "hash-race");
    }
  };
  const socket = new FakeSocket();

  const pending = upgrade(service, socket, auth, token);
  await new Promise<void>((resolve) => setImmediate(resolve));
  bus.publish({ tokenHash: "hash-race" });
  releaseAuthentication();
  await pending;

  assert.equal(socket.destroyed, true);
  assert.match(responseText(socket), /401 Unauthorized/);
  assert.equal((service as any).connectionCount, 0);
  service.onModuleDestroy();
});

test("upgrade rate limits reject abusive IPs before authentication and users after authentication", async () => {
  const token = "d".repeat(43);
  let authCalls = 0;
  const auth = {
    authenticateSession: async () => {
      authCalls += 1;
      return session("user-1", "session-1", "hash-1");
    }
  };
  const bus = new FakeRevocationBus();
  const ipLimited = new RealtimeService({
    consume: async (bucket: string) => bucket === "realtime:upgrade:ip"
      ? { allowed: false, limit: 60, remaining: 0, retryAfterSeconds: 17 }
      : allowed
  } as never, bus as never);
  const ipSocket = new FakeSocket();

  await upgrade(ipLimited, ipSocket, auth, token);
  assert.equal(authCalls, 0);
  assert.match(responseText(ipSocket), /429 Too Many Requests/);
  assert.match(responseText(ipSocket), /Retry-After: 17/);
  ipLimited.onModuleDestroy();

  const userLimited = new RealtimeService({
    consume: async (bucket: string) => bucket === "realtime:upgrade:user"
      ? { allowed: false, limit: 30, remaining: 0, retryAfterSeconds: 9 }
      : allowed
  } as never, new FakeRevocationBus() as never);
  const userSocket = new FakeSocket();
  await upgrade(userLimited, userSocket, auth, token);
  assert.equal(authCalls, 1);
  assert.match(responseText(userSocket), /429 Too Many Requests/);
  assert.match(responseText(userSocket), /Retry-After: 9/);
  userLimited.onModuleDestroy();
});

test("active connection limits are enforced globally, per IP, and per user", async () => {
  const service = new RealtimeService(
    { consume: async () => allowed } as never,
    new FakeRevocationBus() as never
  );
  Object.assign((service as any).limits, {
    maxConnections: 2,
    maxConnectionsPerIp: 1,
    maxConnectionsPerUser: 1
  });
  const tokens = ["e", "f", "g", "h", "i"].map((value) => value.repeat(43));
  const sessions = new Map([
    [tokens[0], session("user-1", "session-1", "hash-1")],
    [tokens[1], session("user-2", "session-2", "hash-2")],
    [tokens[2], session("user-1", "session-3", "hash-3")],
    [tokens[3], session("user-2", "session-4", "hash-4")],
    [tokens[4], session("user-3", "session-5", "hash-5")]
  ]);
  const auth = { authenticateSession: async (token: string) => sessions.get(token) ?? null };

  const first = new FakeSocket();
  await upgrade(service, first, auth, tokens[0]);
  assert.equal(first.destroyed, false);

  const sameIp = new FakeSocket();
  await upgrade(service, sameIp, auth, tokens[1]);
  assert.match(responseText(sameIp), /429 Too Many Requests/);

  const sameUser = new FakeSocket();
  sameUser.remoteAddress = "203.0.113.11";
  await upgrade(service, sameUser, auth, tokens[2]);
  assert.match(responseText(sameUser), /429 Too Many Requests/);

  const second = new FakeSocket();
  second.remoteAddress = "203.0.113.12";
  await upgrade(service, second, auth, tokens[3]);
  assert.equal(second.destroyed, false);

  const global = new FakeSocket();
  global.remoteAddress = "203.0.113.13";
  await upgrade(service, global, auth, tokens[4]);
  assert.match(responseText(global), /503 Service Unavailable/);
  service.onModuleDestroy();
});

test("slow clients are closed when their buffered writes exceed the configured threshold", async () => {
  const service = new RealtimeService(
    { consume: async () => allowed } as never,
    new FakeRevocationBus() as never
  );
  const token = "j".repeat(43);
  const socket = new FakeSocket();
  await upgrade(service, socket, { authenticateSession: async () => session("user-1", "session-1", "hash-1") }, token);
  assert.equal(socket.destroyed, false);

  socket.writableLength = (service as any).limits.maxBufferedBytes;
  service.emitToUser("user-1", "private.event", { payload: "secret" });

  assert.equal(socket.destroyed, true);
  assert.equal((service as any).connectionCount, 0);
  service.onModuleDestroy();
});

test("a backpressured socket that never drains is closed after the grace period", async () => {
  const service = new RealtimeService(
    { consume: async () => allowed } as never,
    new FakeRevocationBus() as never
  );
  (service as any).limits.backpressureTimeoutMs = 10;
  const token = "k".repeat(43);
  const socket = new FakeSocket();
  await upgrade(service, socket, { authenticateSession: async () => session("user-1", "session-1", "hash-1") }, token);
  socket.writeReturns = false;

  service.emitToUser("user-1", "private.event", { payload: "secret" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(socket.destroyed, true);
  assert.equal((service as any).connectionCount, 0);
  service.onModuleDestroy();
});
