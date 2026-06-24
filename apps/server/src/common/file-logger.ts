import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LoggerService, LogLevel } from "@nestjs/common";

const maxLogBytes = 8 * 1024 * 1024;

export class FileLogger implements LoggerService {
  private readonly logDir: string;

  constructor() {
    this.logDir = process.env.CHAQ_LOG_DIR || join(findProjectRoot(), ".logs");
    mkdirSync(this.logDir, { recursive: true });
  }

  log(message: unknown, context?: string): void {
    this.write("log", message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write("error", trace ? `${String(message)}\n${trace}` : message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string): void {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      context,
      message: message instanceof Error ? message.stack || message.message : String(message)
    });
    const file = this.filePath();
    try {
      appendFileSync(file, `${line}\n`, "utf8");
      this.console(level, message, context);
    } catch {
      this.console(level, message, context);
    }
  }

  private filePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    const base = join(this.logDir, `server-${date}.log`);
    try {
      if (statSync(base).size <= maxLogBytes) return base;
      return join(this.logDir, `server-${date}-${Date.now()}.log`);
    } catch {
      return base;
    }
  }

  private console(level: LogLevel, message: unknown, context?: string): void {
    const prefix = context ? `[${context}] ` : "";
    const text = `${prefix}${message instanceof Error ? message.stack || message.message : String(message)}`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
  }
}

function findProjectRoot(): string {
  let current = process.cwd();
  for (let index = 0; index < 6; index += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(current, "package.json"), "utf8"));
      if (pkg?.name === "chaq") return current;
    } catch {
      // Keep walking up.
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return resolve(process.cwd(), "../..");
}
