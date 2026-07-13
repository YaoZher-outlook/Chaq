import { createHash } from "node:crypto";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { Socket } from "node:net";
import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { AuthService } from "../modules/auth/auth.service";
import { RateLimitService, type RateLimitResult } from "./rate-limit.service";
import { realtimeSessionToken } from "./realtime-auth";
import {
  SESSION_REVOCATION_BUS,
  type SessionRevocationBus,
  type SessionRevocationEvent
} from "./session-revocation";

type Client = {
  socket: Socket;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: number;
  ip: string;
  backpressureTimer?: NodeJS.Timeout;
};

type RealtimeLimits = {
  upgradeIpPerMinute: number;
  upgradeUserPerMinute: number;
  upgradeGlobalPerMinute: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxConnectionsPerUser: number;
  maxBufferedBytes: number;
  backpressureTimeoutMs: number;
};

const revocationTombstoneTtlMs = 2 * 60_000;
const maxRevocationTombstones = 10_000;

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<string, Set<Client>>();
  private readonly clientsBySessionId = new Map<string, Set<Client>>();
  private readonly clientsByTokenHash = new Map<string, Set<Client>>();
  private readonly connectionsByIp = new Map<string, number>();
  private readonly revokedSessionIds = new Map<string, number>();
  private readonly revokedTokenHashes = new Map<string, number>();
  private readonly limits = realtimeLimitsFromEnvironment();
  private readonly unsubscribeRevocations: () => void;
  private heartbeat?: NodeJS.Timeout;
  private sequence = 0;
  private connectionCount = 0;
  private bound = false;

  constructor(
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(SESSION_REVOCATION_BUS) sessionRevocations: SessionRevocationBus
  ) {
    this.unsubscribeRevocations = sessionRevocations.subscribe((event) => this.disconnectRevokedSession(event));
  }

  bind(server: Server, auth: AuthService): void {
    if (this.bound) return;
    this.bound = true;
    server.on("upgrade", (request, socket) => {
      void this.handleUpgrade(request.url ?? "", request.headers, socket as Socket, auth);
    });
    this.heartbeat = setInterval(() => this.emitHeartbeat(), 25_000);
    this.heartbeat.unref?.();
    this.logger.log("Realtime WebSocket endpoint is listening on /api/realtime");
  }

  onModuleDestroy(): void {
    this.unsubscribeRevocations();
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of [...this.clients.values()]) {
      for (const client of [...set]) this.close(client);
    }
    this.clients.clear();
    this.clientsBySessionId.clear();
    this.clientsByTokenHash.clear();
    this.connectionsByIp.clear();
    this.revokedSessionIds.clear();
    this.revokedTokenHashes.clear();
  }

  emitToUser(userId: string, type: string, payload: unknown): void {
    const clients = this.clients.get(userId);
    if (!clients?.size) return;
    const data = this.eventFrame(type, payload);
    for (const client of [...clients]) {
      this.send(client, data);
    }
  }

  emitToUsers(userIds: Iterable<string>, type: string, payload: unknown): void {
    for (const userId of new Set(userIds)) {
      this.emitToUser(userId, type, payload);
    }
  }

  private async handleUpgrade(
    rawUrl: string,
    headers: IncomingHttpHeaders,
    socket: Socket,
    auth: AuthService
  ): Promise<void> {
    try {
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname !== "/api/realtime") {
        socket.destroy();
        return;
      }

      const ip = realtimeClientIp(headers, socket.remoteAddress);
      const preAuthLimits = await Promise.all([
        this.rateLimit.consume(
          "realtime:upgrade:ip",
          rateLimitIdentity(ip),
          this.limits.upgradeIpPerMinute,
          60,
          { failureMode: "local" }
        ),
        this.rateLimit.consume(
          "realtime:upgrade:global",
          "all",
          this.limits.upgradeGlobalPerMinute,
          60,
          { failureMode: "local" }
        )
      ]);
      const preAuthBlocked = blockedLimit(preAuthLimits);
      if (preAuthBlocked) {
        this.rejectUpgrade(socket, 429, "Too Many Requests", preAuthBlocked.retryAfterSeconds);
        return;
      }

      const token = realtimeSessionToken(headers["sec-websocket-protocol"]);
      if (!token) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const session = await auth.authenticateSession(token);
      if (!session) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }

      const userLimit = await this.rateLimit.consume(
        "realtime:upgrade:user",
        rateLimitIdentity(session.user.id),
        this.limits.upgradeUserPerMinute,
        60,
        { failureMode: "local" }
      );
      if (!userLimit.allowed) {
        this.rejectUpgrade(socket, 429, "Too Many Requests", userLimit.retryAfterSeconds);
        return;
      }

      // A logout may finish while authentication or rate limiting is awaiting.
      // The revocation listener records a short-lived tombstone, so that race
      // cannot resurrect an already revoked session as a new socket.
      if (this.isRecentlyRevoked(session.sessionId, session.tokenHash)) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const capacityError = this.capacityError(ip, session.user.id);
      if (capacityError) {
        this.rejectUpgrade(socket, capacityError.status, capacityError.reason, 30);
        return;
      }

      const key = firstHeader(headers["sec-websocket-key"]);
      if (!key) {
        this.rejectUpgrade(socket, 400, "Bad Request");
        return;
      }
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      const handshake = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "Sec-WebSocket-Protocol: chaq-v1",
        "\r\n"
      ].join("\r\n");
      if (!socket.write(handshake)) {
        socket.destroy();
        return;
      }

      const client: Client = {
        socket,
        userId: session.user.id,
        sessionId: session.sessionId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt.getTime(),
        ip
      };
      this.add(client);
      socket.setNoDelay?.(true);
      socket.on("close", () => this.remove(client));
      socket.on("end", () => this.remove(client));
      socket.on("error", () => this.remove(client));
      // The current protocol is server-push only. Reading and discarding keeps
      // the stream flowing without granting clients a hidden command channel.
      socket.on("data", () => undefined);
      this.send(client, this.eventFrame("realtime.ready", { userId: session.user.id }));
    } catch (error) {
      this.logger.warn(`Realtime upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      socket.destroy();
    }
  }

  private capacityError(ip: string, userId: string): { status: number; reason: string } | null {
    if (this.connectionCount >= this.limits.maxConnections) {
      return { status: 503, reason: "Service Unavailable" };
    }
    if ((this.connectionsByIp.get(ip) ?? 0) >= this.limits.maxConnectionsPerIp) {
      return { status: 429, reason: "Too Many Requests" };
    }
    if ((this.clients.get(userId)?.size ?? 0) >= this.limits.maxConnectionsPerUser) {
      return { status: 429, reason: "Too Many Requests" };
    }
    return null;
  }

  private add(client: Client): void {
    addToIndex(this.clients, client.userId, client);
    addToIndex(this.clientsBySessionId, client.sessionId, client);
    addToIndex(this.clientsByTokenHash, client.tokenHash, client);
    this.connectionsByIp.set(client.ip, (this.connectionsByIp.get(client.ip) ?? 0) + 1);
    this.connectionCount += 1;
  }

  private send(client: Client, data: string): void {
    if (
      client.expiresAt <= Date.now() ||
      this.isRecentlyRevoked(client.sessionId, client.tokenHash) ||
      client.socket.destroyed ||
      !client.socket.writable
    ) {
      this.close(client);
      return;
    }

    const frame = this.frame(data);
    if (client.socket.writableLength + frame.length > this.limits.maxBufferedBytes) {
      this.logger.warn(`Closing slow realtime client for user ${client.userId}: write buffer limit exceeded`);
      this.close(client);
      return;
    }

    try {
      if (!client.socket.write(frame)) this.armBackpressureTimeout(client);
    } catch {
      this.close(client);
    }
  }

  private armBackpressureTimeout(client: Client): void {
    if (client.backpressureTimer) return;
    const clear = () => {
      if (client.backpressureTimer) clearTimeout(client.backpressureTimer);
      client.backpressureTimer = undefined;
    };
    client.socket.once("drain", clear);
    client.backpressureTimer = setTimeout(() => {
      client.backpressureTimer = undefined;
      this.logger.warn(`Closing slow realtime client for user ${client.userId}: socket did not drain`);
      this.close(client);
    }, this.limits.backpressureTimeoutMs);
    client.backpressureTimer.unref?.();
  }

  private disconnectRevokedSession(event: SessionRevocationEvent): void {
    this.rememberRevocation(event);
    const targets = new Set<Client>();
    if (event.sessionId) {
      for (const client of this.clientsBySessionId.get(event.sessionId) ?? []) targets.add(client);
    }
    if (event.tokenHash) {
      for (const client of this.clientsByTokenHash.get(event.tokenHash) ?? []) targets.add(client);
    }
    for (const client of targets) this.close(client);
  }

  private rememberRevocation(event: SessionRevocationEvent): void {
    const expiresAt = Date.now() + revocationTombstoneTtlMs;
    if (event.sessionId) this.revokedSessionIds.set(event.sessionId, expiresAt);
    if (event.tokenHash) this.revokedTokenHashes.set(event.tokenHash, expiresAt);
    this.pruneRevocationTombstones();
  }

  private isRecentlyRevoked(sessionId: string, tokenHash: string): boolean {
    const now = Date.now();
    return tombstoneIsActive(this.revokedSessionIds, sessionId, now) ||
      tombstoneIsActive(this.revokedTokenHashes, tokenHash, now);
  }

  private pruneRevocationTombstones(): void {
    const now = Date.now();
    pruneTombstones(this.revokedSessionIds, now);
    pruneTombstones(this.revokedTokenHashes, now);
  }

  private emitHeartbeat(): void {
    const data = this.eventFrame("realtime.heartbeat", { clients: this.connectionCount });
    for (const set of [...this.clients.values()]) {
      for (const client of [...set]) this.send(client, data);
    }
  }

  private eventFrame(type: string, payload: unknown): string {
    this.sequence = (this.sequence + 1) % Number.MAX_SAFE_INTEGER;
    return JSON.stringify({ type, payload, at: new Date().toISOString(), seq: this.sequence });
  }

  private frame(data: string): Buffer {
    const payload = Buffer.from(data, "utf8");
    if (payload.length < 126) {
      return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    }
    if (payload.length < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
      return Buffer.concat([header, payload]);
    }
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    return Buffer.concat([header, payload]);
  }

  private rejectUpgrade(socket: Socket, status: number, reason: string, retryAfterSeconds?: number): void {
    if (socket.destroyed) return;
    const headers = [
      `HTTP/1.1 ${status} ${reason}`,
      "Connection: close",
      "Content-Length: 0",
      ...(retryAfterSeconds ? [`Retry-After: ${Math.max(1, Math.ceil(retryAfterSeconds))}`] : []),
      "\r\n"
    ];
    try {
      socket.write(headers.join("\r\n"));
    } finally {
      socket.destroy();
    }
  }

  private close(client: Client): void {
    this.remove(client);
    if (!client.socket.destroyed) client.socket.destroy();
  }

  private remove(client: Client): void {
    const removed = removeFromIndex(this.clients, client.userId, client);
    if (!removed) return;
    removeFromIndex(this.clientsBySessionId, client.sessionId, client);
    removeFromIndex(this.clientsByTokenHash, client.tokenHash, client);
    const ipCount = this.connectionsByIp.get(client.ip) ?? 0;
    if (ipCount <= 1) this.connectionsByIp.delete(client.ip);
    else this.connectionsByIp.set(client.ip, ipCount - 1);
    this.connectionCount = Math.max(0, this.connectionCount - 1);
    if (client.backpressureTimer) clearTimeout(client.backpressureTimer);
    client.backpressureTimer = undefined;
  }
}

function realtimeLimitsFromEnvironment(): RealtimeLimits {
  return {
    upgradeIpPerMinute: environmentInteger("REALTIME_UPGRADE_IP_PER_MINUTE", 60, 1, 100_000),
    upgradeUserPerMinute: environmentInteger("REALTIME_UPGRADE_USER_PER_MINUTE", 30, 1, 100_000),
    upgradeGlobalPerMinute: environmentInteger("REALTIME_UPGRADE_GLOBAL_PER_MINUTE", 3_000, 1, 1_000_000),
    maxConnections: environmentInteger("REALTIME_MAX_CONNECTIONS", 5_000, 1, 100_000),
    maxConnectionsPerIp: environmentInteger("REALTIME_MAX_CONNECTIONS_PER_IP", 50, 1, 10_000),
    maxConnectionsPerUser: environmentInteger("REALTIME_MAX_CONNECTIONS_PER_USER", 5, 1, 1_000),
    maxBufferedBytes: environmentInteger("REALTIME_MAX_BUFFERED_BYTES", 512 * 1024, 16 * 1024, 64 * 1024 * 1024),
    backpressureTimeoutMs: environmentInteger("REALTIME_BACKPRESSURE_TIMEOUT_MS", 10_000, 100, 120_000)
  };
}

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function blockedLimit(results: RateLimitResult[]): RateLimitResult | undefined {
  return results.find((result) => !result.allowed);
}

function rateLimitIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function realtimeClientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const remote = normalizeIp(remoteAddress ?? "unknown");
  const trustedHops = /^\d+$/.test(process.env.TRUST_PROXY?.trim() ?? "")
    ? Number(process.env.TRUST_PROXY)
    : 0;
  if (trustedHops < 1 || trustedHops > 10) return remote;
  const forwarded = (firstHeader(headers["x-forwarded-for"]) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!forwarded.length) return remote;
  return normalizeIp(forwarded[Math.max(0, forwarded.length - trustedHops)] ?? remote);
}

function normalizeIp(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized || "unknown";
}

function addToIndex(index: Map<string, Set<Client>>, key: string, client: Client): void {
  const set = index.get(key) ?? new Set<Client>();
  set.add(client);
  index.set(key, set);
}

function removeFromIndex(index: Map<string, Set<Client>>, key: string, client: Client): boolean {
  const set = index.get(key);
  if (!set || !set.delete(client)) return false;
  if (!set.size) index.delete(key);
  return true;
}

function tombstoneIsActive(index: Map<string, number>, key: string, now: number): boolean {
  const expiresAt = index.get(key);
  if (!expiresAt) return false;
  if (expiresAt > now) return true;
  index.delete(key);
  return false;
}

function pruneTombstones(index: Map<string, number>, now: number): void {
  for (const [key, expiresAt] of index) {
    if (expiresAt <= now) index.delete(key);
  }
  while (index.size > maxRevocationTombstones) {
    const oldest = index.keys().next().value as string | undefined;
    if (!oldest) break;
    index.delete(oldest);
  }
}
