import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { Injectable, Logger } from "@nestjs/common";
import { AuthService } from "../modules/auth/auth.service";

type Client = {
  socket: Socket;
  userId: string;
};

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<string, Set<Client>>();
  private bound = false;

  bind(server: Server, auth: AuthService): void {
    if (this.bound) return;
    this.bound = true;
    server.on("upgrade", (request, socket) => {
      void this.handleUpgrade(request.url ?? "", request.headers, socket as Socket, auth);
    });
    this.logger.log("Realtime WebSocket endpoint is listening on /api/realtime");
  }

  emitToUser(userId: string, type: string, payload: unknown): void {
    const clients = this.clients.get(userId);
    if (!clients?.size) return;
    const data = JSON.stringify({ type, payload, at: new Date().toISOString() });
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
    headers: Record<string, string | string[] | undefined>,
    socket: Socket,
    auth: AuthService
  ): Promise<void> {
    try {
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname !== "/api/realtime") {
        socket.destroy();
        return;
      }
      const token = url.searchParams.get("token") ?? "";
      const user = await auth.userForSession(token);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const key = Array.isArray(headers["sec-websocket-key"]) ? headers["sec-websocket-key"][0] : headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n"
      ].join("\r\n"));
      const client: Client = { socket, userId: user.id };
      const set = this.clients.get(user.id) ?? new Set<Client>();
      set.add(client);
      this.clients.set(user.id, set);
      socket.on("close", () => this.remove(client));
      socket.on("error", () => this.remove(client));
      socket.on("data", () => undefined);
      this.send(client, JSON.stringify({ type: "realtime.ready", payload: { userId: user.id }, at: new Date().toISOString() }));
    } catch (error) {
      this.logger.warn(`Realtime upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      socket.destroy();
    }
  }

  private send(client: Client, data: string): void {
    try {
      client.socket.write(this.frame(data));
    } catch {
      this.remove(client);
    }
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

  private remove(client: Client): void {
    const set = this.clients.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (!set.size) this.clients.delete(client.userId);
  }
}
