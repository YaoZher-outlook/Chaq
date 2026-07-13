import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LoggerService, LogLevel } from "@nestjs/common";

const maxLogBytes = 8 * 1024 * 1024;

export class FileLogger implements LoggerService {
  private readonly logDir: string;
  private fileLoggingEnabled: boolean;
  private logDate = "";
  private logIndex = 0;

  constructor() {
    this.logDir = process.env.CHAQ_LOG_DIR || join(findProjectRoot(), ".logs");
    this.fileLoggingEnabled = process.env.CHAQ_LOG_STDOUT_ONLY !== "1";
    if (this.fileLoggingEnabled) {
      try {
        mkdirSync(this.logDir, { recursive: true });
      } catch (error) {
        this.fileLoggingEnabled = false;
        console.warn(`[FileLogger] File logging disabled: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
    if (this.fileLoggingEnabled) {
      try {
        appendFileSync(this.filePath(), `${line}\n`, "utf8");
      } catch {
        this.fileLoggingEnabled = false;
      }
    }
    this.console(level, message, context);
  }

  private filePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    if (date !== this.logDate) {
      this.logDate = date;
      this.logIndex = 0;
    }

    while (true) {
      const suffix = this.logIndex === 0 ? "" : `-${String(this.logIndex).padStart(3, "0")}`;
      const file = join(this.logDir, `server-${date}${suffix}.log`);
      try {
        if (statSync(file).size < maxLogBytes) return file;
        this.logIndex += 1;
      } catch {
        return file;
      }
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
