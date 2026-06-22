import type { ConnectionOptions } from "bullmq";

export const agentRunQueueName = "chaq-agent-runs";

export function redisConnectionOptions(): ConnectionOptions {
  const value = process.env.REDIS_URL || "redis://127.0.0.1:46379";
  const url = new URL(value);
  const db = Number(url.pathname.replace(/^\//, "") || 0);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    maxRetriesPerRequest: null
  };
}
