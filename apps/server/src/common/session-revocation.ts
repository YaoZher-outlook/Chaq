import { Injectable, Logger } from "@nestjs/common";

export type SessionRevocationEvent = {
  sessionId?: string;
  tokenHash?: string;
};

export type SessionRevocationListener = (event: SessionRevocationEvent) => void;

/**
 * Abstraction used by authentication and realtime delivery to coordinate
 * session revocations. Multi-instance deployments can replace this provider
 * with a broker-backed implementation (for example Redis pub/sub) without
 * coupling AuthService to the WebSocket implementation.
 *
 * Implementations must notify local subscribers synchronously before publish
 * returns. That closes the race where an upgrade authenticated immediately
 * before logout and is registered immediately after it.
 */
export interface SessionRevocationBus {
  publish(event: SessionRevocationEvent): void;
  subscribe(listener: SessionRevocationListener): () => void;
}

export const SESSION_REVOCATION_BUS = Symbol("SESSION_REVOCATION_BUS");

@Injectable()
export class InMemorySessionRevocationBus implements SessionRevocationBus {
  private readonly logger = new Logger(InMemorySessionRevocationBus.name);
  private readonly listeners = new Set<SessionRevocationListener>();

  publish(event: SessionRevocationEvent): void {
    if (!event.sessionId && !event.tokenHash) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(`Session revocation listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  subscribe(listener: SessionRevocationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
