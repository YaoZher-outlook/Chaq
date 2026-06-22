import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:46379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  private connected = false;

  async consume(bucket: string, identity: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
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
      return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.redis.quit().catch(() => undefined);
  }
}
