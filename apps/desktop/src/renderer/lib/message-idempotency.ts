type PendingMessage = {
  conversationId: string;
  content: string;
  key: string;
};

export class PendingMessageKey {
  private pending: PendingMessage | null = null;

  constructor(private readonly createKey: () => string = () => globalThis.crypto.randomUUID()) {}

  matches(conversationId: string, content: string): boolean {
    return this.pending?.conversationId === conversationId && this.pending.content === content.trim();
  }

  begin(conversationId: string, content: string): string {
    const normalized = content.trim();
    const pending = this.pending;
    if (pending?.conversationId === conversationId && pending.content === normalized) {
      return pending.key;
    }
    const key = this.createKey();
    if (key.length < 8 || key.length > 200) throw new Error("Invalid message idempotency key.");
    this.pending = { conversationId, content: normalized, key };
    return key;
  }

  contentChanged(conversationId: string | null, content: string): void {
    if (!this.pending) return;
    if (this.pending.conversationId !== conversationId || this.pending.content !== content.trim()) {
      this.pending = null;
    }
  }

  succeeded(key: string): void {
    if (this.pending?.key === key) this.pending = null;
  }

  clear(): void {
    this.pending = null;
  }
}
