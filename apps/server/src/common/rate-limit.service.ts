import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  failureMode?: "allow" | "deny" | "local";
};

type LocalBucket = {
  count: number;
  expiresAt: number;
};

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:46379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  private connected = false;
  private readonly localBuckets = new Map<string, LocalBucket>();

  async consume(
    bucket: string,
    identity: string,
    limit: number,
    windowSeconds: number,
    options: RateLimitOptions = {}
  ): Promise<RateLimitResult> {
    try {
      if (!this.connected) {
        await this.redis.connect();
        this.connected = true;
      }
      const key = `chaq:rate:${bucket}:${identity}`;
      const result = await this.redis.eval(
        "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('TTL', KEYS[1]); return {current, ttl}",
        1,
        key,
        windowSeconds
      ) as [number, number];
      const current = Number(result[0]);
      const ttl = Math.max(1, Number(result[1]));
      return {
        allowed: current <= limit,
        limit,
        remaining: Math.max(0, limit - current),
        retryAfterSeconds: ttl
      };
    } catch {
      this.connected = false;
      if (options.failureMode === "deny") {
        return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, windowSeconds) };
      }
      if (options.failureMode === "local") {
        return this.consumeLocal(bucket, identity, limit, windowSeconds);
      }
      return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
    }
  }

  private consumeLocal(bucket: string, identity: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const key = `${bucket}:${identity}`;
    let row = this.localBuckets.get(key);
    if (!row || row.expiresAt <= now) {
      if (!row && this.localBuckets.size >= 10_000) {
        const oldest = this.localBuckets.keys().next().value as string | undefined;
        if (oldest) this.localBuckets.delete(oldest);
      }
      row = { count: 0, expiresAt: now + windowSeconds * 1000 };
    }
    row.count += 1;
    this.localBuckets.set(key, row);
    return {
      allowed: row.count <= limit,
      limit,
      remaining: Math.max(0, limit - row.count),
      retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt - now) / 1000))
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.redis.quit().catch(() => undefined);
  }
}
