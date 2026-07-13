import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { Database, type SqlJsStatic } from "sql.js";
import type {
  ChatMessage,
  SkillAutoMessageSettings,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  SkillVersionSnapshot,
  UserModelConfigPublic
} from "@chaq/shared";

type CryptoCodec = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

type SecretModelConfig = UserModelConfigPublic & {
  apiKey: string;
};

type SkillRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  persona: string;
  tone: string;
  knowledge: string;
  boundaries: string;
  examples_json: string;
  tags_json: string;
  visibility: "private" | "public";
  active_version_id: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  skill_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_label: string | null;
  created_at: string;
};

type ModelConfigRow = {
  id: string;
  user_id: string;
  kind: UserModelConfigPublic["kind"];
  name: string;
  base_url: string;
  api_key_ciphertext: string;
  default_model: string;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
};

type SkillAutoSettingsRow = {
  skill_id: string;
  enabled: number;
  mode: SkillAutoMessageSettings["mode"];
  fixed_period: SkillAutoMessageSettings["fixedPeriod"];
  fixed_count: number;
  random_token_limit: number | null;
  random_unlimited: number;
  do_not_disturb: number;
  last_synced_at: string | null;
  updated_at: string;
};

export type LocalDatabaseOptions = {
  /** Coalesces several synchronous sql.js mutations into one durable file replacement. */
  persistDelayMs?: number;
};

type DatabaseCandidate = {
  bytes: Buffer;
};

const DEFAULT_PERSIST_DELAY_MS = 250;
const LOCAL_SCHEMA_VERSION = 1;

export class LocalDatabase {
  private readonly persistDelayMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private closed = false;

  private constructor(
    private readonly dbPath: string,
    private readonly codec: CryptoCodec,
    private readonly db: Database,
    options: LocalDatabaseOptions,
    needsInitialPersist: boolean
  ) {
    this.persistDelayMs = normalizePersistDelay(options.persistDelayMs);
    this.init(needsInitialPersist);
  }

  static async create(
    dbPath: string,
    codec: CryptoCodec,
    options: LocalDatabaseOptions = {}
  ): Promise<LocalDatabase> {
    mkdirSync(dirname(dbPath), { recursive: true });
    const SQL = await initSqlJs();
    const recovered = recoverDatabaseFile(SQL, dbPath);
    const db = recovered.bytes ? new SQL.Database(recovered.bytes) : new SQL.Database();
    return new LocalDatabase(dbPath, codec, db, options, !recovered.bytes);
  }

  /** Immediately writes all pending mutations. Safe to call repeatedly. */
  flush(): void {
    this.cancelPersistTimer();
    if (this.closed || !this.dirty) {
      return;
    }

    const bytes = Buffer.from(this.db.export());
    persistDatabaseFile(this.dbPath, bytes);
    this.dirty = false;
  }

  /** Flushes pending data and releases the sql.js database. Safe to call repeatedly. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.db.close();
    this.closed = true;
  }

  listSkills(): SkillSummary[] {
    const rows = this.all<SkillRow>("select * from skills order by updated_at desc");
    return rows.map((row) => this.toSkill(row));
  }

  getSkill(id: string): SkillSummary | null {
    const row = this.get<SkillRow>("select * from skills where id = ?", [id]);
    return row ? this.toSkill(row) : null;
  }

  cacheSkills(skills: SkillSummary[]): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const skill of skills) {
        const versionId = skill.activeVersionId ?? randomUUID();
        this.run(
          `insert into skills (
            id, name, avatar_url, description, persona, tone, knowledge, boundaries,
            examples_json, tags_json, visibility, active_version_id, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            name = excluded.name,
            avatar_url = excluded.avatar_url,
            description = excluded.description,
            persona = excluded.persona,
            tone = excluded.tone,
            knowledge = excluded.knowledge,
            boundaries = excluded.boundaries,
            examples_json = excluded.examples_json,
            tags_json = excluded.tags_json,
            visibility = excluded.visibility,
            active_version_id = excluded.active_version_id,
            updated_at = excluded.updated_at`,
          [
            skill.id,
            skill.name,
            skill.avatarUrl ?? null,
            skill.description,
            skill.persona,
            skill.tone,
            skill.knowledge,
            skill.boundaries,
            JSON.stringify(skill.examples),
            JSON.stringify(skill.tags),
            skill.visibility,
            versionId,
            skill.createdAt || now,
            skill.updatedAt || now
          ],
          false
        );
      }
    });
  }

  createSkill(skill: SkillDraft, sourceKind: SkillSourceKind = "manual", id?: string): SkillSummary {
    const now = new Date().toISOString();
    const skillId = id || randomUUID();
    const versionId = randomUUID();
    this.transaction(() => {
      this.run(
        `insert into skills (
          id, name, avatar_url, description, persona, tone, knowledge, boundaries,
          examples_json, tags_json, visibility, active_version_id, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?)`
      ,
      [
        skillId,
        skill.name,
        skill.avatarUrl ?? null,
        skill.description,
        skill.persona,
        skill.tone,
        skill.knowledge,
        skill.boundaries,
        JSON.stringify(skill.examples),
        JSON.stringify(skill.tags),
        versionId,
        now,
        now
      ], false);
      this.insertVersion(versionId, skillId, 1, sourceKind, "confirmed", skill, now);
    });
    return this.getSkill(skillId)!;
  }

  getSkillAutoMessageSettings(skillId: string): SkillAutoMessageSettings {
    const row = this.get<SkillAutoSettingsRow>("select * from skill_auto_message_settings where skill_id = ?", [skillId]);
    return row ? this.toAutoSettings(row) : defaultAutoSettings(skillId);
  }

  saveSkillAutoMessageSettings(input: SkillAutoMessageSettings): SkillAutoMessageSettings {
    const updatedAt = new Date().toISOString();
    this.run(
      `insert into skill_auto_message_settings (
        skill_id, enabled, mode, fixed_period, fixed_count, random_token_limit,
        random_unlimited, do_not_disturb, last_synced_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(skill_id) do update set
        enabled = excluded.enabled,
        mode = excluded.mode,
        fixed_period = excluded.fixed_period,
        fixed_count = excluded.fixed_count,
        random_token_limit = excluded.random_token_limit,
        random_unlimited = excluded.random_unlimited,
        do_not_disturb = excluded.do_not_disturb,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at`
    , [
      input.skillId,
      input.enabled ? 1 : 0,
      input.mode,
      input.fixedPeriod,
      input.fixedCount,
      input.randomTokenLimit ?? null,
      input.randomUnlimited ? 1 : 0,
      input.doNotDisturb ? 1 : 0,
      input.lastSyncedAt ?? null,
      updatedAt
    ]);
    return this.getSkillAutoMessageSettings(input.skillId);
  }

  updateSkill(id: string, skill: SkillDraft, sourceKind: SkillSourceKind = "manual"): SkillSummary {
    const existing = this.getSkill(id);
    if (!existing) {
      throw new Error("Skill not found.");
    }
    const now = new Date().toISOString();
    const version = this.get<{ value?: number }>("select max(version) as value from skill_versions where skill_id = ?", [id])?.value ?? 0;
    const versionId = randomUUID();
    this.transaction(() => {
      this.run(
        `update skills set
          name = ?, avatar_url = ?, description = ?, persona = ?, tone = ?, knowledge = ?, boundaries = ?,
          examples_json = ?, tags_json = ?, active_version_id = ?, updated_at = ?
        where id = ?`
      ,
      [
        skill.name,
        skill.avatarUrl ?? null,
        skill.description,
        skill.persona,
        skill.tone,
        skill.knowledge,
        skill.boundaries,
        JSON.stringify(skill.examples),
        JSON.stringify(skill.tags),
        versionId,
        now,
        id
      ], false);
      this.insertVersion(versionId, id, version + 1, sourceKind, "confirmed", skill, now);
    });
    return this.getSkill(id)!;
  }

  deleteSkill(id: string): void {
    this.run("delete from skills where id = ?", [id]);
  }

  listVersions(skillId: string): SkillVersionSnapshot[] {
    const rows = this.all<any>("select * from skill_versions where skill_id = ? order by version desc", [skillId]);
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      version: row.version,
      sourceKind: row.source_kind,
      status: row.status,
      name: row.name,
      avatarUrl: row.avatar_url,
      description: row.description,
      persona: row.persona,
      tone: row.tone,
      knowledge: row.knowledge,
      boundaries: row.boundaries,
      examples: safeJson(row.examples_json, []),
      tags: safeJson(row.tags_json, []),
      createdAt: row.created_at
    }));
  }

  listMessages(skillId: string): ChatMessage[] {
    const rows = this.all<MessageRow>("select * from messages where skill_id = ? order by created_at asc", [skillId]);
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      role: row.role,
      content: row.content,
      modelLabel: row.model_label,
      createdAt: row.created_at
    }));
  }

  addMessage(input: {
    skillId: string;
    role: ChatMessage["role"];
    content: string;
    modelLabel?: string | null;
  }): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      skillId: input.skillId,
      role: input.role,
      content: input.content,
      modelLabel: input.modelLabel ?? null,
      createdAt: new Date().toISOString()
    };
    this.run(
      "insert into messages (id, skill_id, role, content, model_label, created_at) values (?, ?, ?, ?, ?, ?)"
    , [message.id, message.skillId, message.role, message.content, message.modelLabel, message.createdAt]);
    return message;
  }

  clearMessages(skillId: string): void {
    this.run("delete from messages where skill_id = ?", [skillId]);
  }

  saveImport(input: {
    sourceKind: SkillSourceKind;
    fileName: string;
    messages: unknown[];
    warnings: string[];
    draft?: SkillDraft | null;
  }) {
    const row = {
      id: randomUUID(),
      sourceKind: input.sourceKind,
      fileName: input.fileName,
      messagesJson: JSON.stringify(input.messages),
      warningsJson: JSON.stringify(input.warnings),
      draftJson: input.draft ? JSON.stringify(input.draft) : null,
      createdAt: new Date().toISOString()
    };
    this.run(
      "insert into imports (id, source_kind, file_name, messages_json, warnings_json, draft_json, created_at) values (?, ?, ?, ?, ?, ?, ?)"
    , [row.id, row.sourceKind, row.fileName, row.messagesJson, row.warningsJson, row.draftJson, row.createdAt]);
    return row;
  }

  listUserModelConfigs(userId = "local"): UserModelConfigPublic[] {
    const rows = this.all<Omit<ModelConfigRow, "api_key_ciphertext">>(
      "select id, user_id, kind, name, base_url, default_model, embedding_model, created_at, updated_at from user_model_configs where user_id = ? order by updated_at desc",
      [userId]
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      embeddingModel: row.embedding_model ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  saveUserModelConfig(input: {
    userId?: string;
    id?: string;
    kind: UserModelConfigPublic["kind"];
    name: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    embeddingModel?: string | null;
  }): UserModelConfigPublic {
    const now = new Date().toISOString();
    const id = input.id || randomUUID();
    const userId = input.userId || "local";
    const ciphertext = this.codec.encrypt(input.apiKey);
    this.run(
      `insert into user_model_configs (id, user_id, kind, name, base_url, api_key_ciphertext, default_model, embedding_model, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         user_id = excluded.user_id,
         kind = excluded.kind,
         name = excluded.name,
         base_url = excluded.base_url,
         api_key_ciphertext = excluded.api_key_ciphertext,
         default_model = excluded.default_model,
          embedding_model = excluded.embedding_model,
         updated_at = excluded.updated_at`
    , [id, userId, input.kind, input.name, input.baseUrl.replace(/\/$/, ""), ciphertext, input.defaultModel, input.embeddingModel ?? "", now, now]);
    return this.listUserModelConfigs(userId).find((config) => config.id === id)!;
  }

  deleteUserModelConfig(id: string, userId = "local"): void {
    this.run("delete from user_model_configs where id = ? and user_id = ?", [id, userId]);
  }

  getSecretModelConfig(id: string, userId = "local"): SecretModelConfig {
    const row = this.get<ModelConfigRow>("select * from user_model_configs where id = ? and user_id = ?", [id, userId]);
    if (!row) {
      throw new Error("User model config not found.");
    }
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      embeddingModel: row.embedding_model ?? "",
      apiKey: this.codec.decrypt(row.api_key_ciphertext),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private init(needsInitialPersist: boolean): void {
    const schemaVersionBefore = this.readPragmaNumber("schema_version");
    const userVersionBefore = this.readPragmaNumber("user_version");
    this.db.run("pragma foreign_keys = on");
    this.db.exec(`
      create table if not exists skills (
        id text primary key,
        name text not null,
        avatar_url text,
        description text not null,
        persona text not null,
        tone text not null,
        knowledge text not null default '',
        boundaries text not null default '',
        examples_json text not null,
        tags_json text not null,
        visibility text not null default 'private',
        active_version_id text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists skill_versions (
        id text primary key,
        skill_id text not null references skills(id) on delete cascade,
        version integer not null,
        source_kind text not null,
        status text not null,
        name text not null,
        avatar_url text,
        description text not null,
        persona text not null,
        tone text not null,
        knowledge text not null default '',
        boundaries text not null default '',
        examples_json text not null,
        tags_json text not null,
        created_at text not null,
        unique(skill_id, version)
      );

      create table if not exists messages (
        id text primary key,
        skill_id text not null references skills(id) on delete cascade,
        role text not null,
        content text not null,
        model_label text,
        created_at text not null
      );

      create table if not exists imports (
        id text primary key,
        source_kind text not null,
        file_name text not null,
        messages_json text not null,
        warnings_json text not null,
        draft_json text,
        created_at text not null
      );

      create table if not exists user_model_configs (
        id text primary key,
        user_id text not null default 'local',
        kind text not null,
        name text not null,
        base_url text not null,
        api_key_ciphertext text not null,
        default_model text not null,
        embedding_model text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists skill_auto_message_settings (
        skill_id text primary key references skills(id) on delete cascade,
        enabled integer not null default 0,
        mode text not null default 'fixed',
        fixed_period text not null default 'day',
        fixed_count integer not null default 1,
        random_token_limit integer,
        random_unlimited integer not null default 0,
        do_not_disturb integer not null default 0,
        last_synced_at text,
        updated_at text not null
      );

      create index if not exists idx_messages_skill on messages(skill_id, created_at);
      create index if not exists idx_versions_skill on skill_versions(skill_id, version);
    `);
    this.addColumnIfMissing(
      "alter table user_model_configs add column user_id text not null default 'local'",
      "user_id"
    );
    this.addColumnIfMissing(
      "alter table user_model_configs add column embedding_model text",
      "embedding_model"
    );
    this.db.run("create index if not exists idx_user_model_configs_user on user_model_configs(user_id, updated_at)");
    if (userVersionBefore < LOCAL_SCHEMA_VERSION) {
      this.db.run(`pragma user_version = ${LOCAL_SCHEMA_VERSION}`);
    }

    const schemaChanged = this.readPragmaNumber("schema_version") !== schemaVersionBefore;
    if (needsInitialPersist || schemaChanged || userVersionBefore < LOCAL_SCHEMA_VERSION) {
      this.dirty = true;
      this.flush();
    }
  }

  private addColumnIfMissing(statement: string, column: string): void {
    try {
      this.db.run(statement);
    } catch (error) {
      if (!isDuplicateColumnError(error, column)) throw error;
    }
  }

  private insertVersion(
    id: string,
    skillId: string,
    version: number,
    sourceKind: SkillSourceKind,
    status: "draft" | "confirmed" | "discarded",
    skill: SkillDraft,
    createdAt: string
  ): void {
    this.run(
      `insert into skill_versions (
        id, skill_id, version, source_kind, status, name, avatar_url, description, persona, tone,
        knowledge, boundaries, examples_json, tags_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ,
    [
      id,
      skillId,
      version,
      sourceKind,
      status,
      skill.name,
      skill.avatarUrl ?? null,
      skill.description,
      skill.persona,
      skill.tone,
      skill.knowledge,
      skill.boundaries,
      JSON.stringify(skill.examples),
      JSON.stringify(skill.tags),
      createdAt
    ], false);
  }

  private toSkill(row: SkillRow): SkillSummary {
    return {
      id: row.id,
      ownerId: "local",
      visibility: row.visibility,
      activeVersionId: row.active_version_id,
      name: row.name,
      avatarUrl: row.avatar_url,
      description: row.description,
      persona: row.persona,
      tone: row.tone,
      knowledge: row.knowledge,
      boundaries: row.boundaries,
      examples: safeJson(row.examples_json, []),
      tags: safeJson(row.tags_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toAutoSettings(row: SkillAutoSettingsRow): SkillAutoMessageSettings {
    return {
      skillId: row.skill_id,
      enabled: Boolean(row.enabled),
      mode: row.mode,
      fixedPeriod: row.fixed_period,
      fixedCount: row.fixed_count,
      randomTokenLimit: row.random_token_limit,
      randomUnlimited: Boolean(row.random_unlimited),
      doNotDisturb: Boolean(row.do_not_disturb),
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at
    };
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as any[]);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  private run(sql: string, params: unknown[] = [], persist = true): void {
    this.db.run(sql, params as any[]);
    if (persist) {
      this.schedulePersist();
    }
  }

  private transaction(action: () => void): void {
    this.db.run("begin");
    try {
      action();
      this.db.run("commit");
      this.schedulePersist();
    } catch (error) {
      this.db.run("rollback");
      throw error;
    }
  }

  private readPragmaNumber(name: "schema_version" | "user_version"): number {
    const result = this.db.exec(`pragma ${name}`);
    const value = result[0]?.values[0]?.[0];
    return typeof value === "number" ? value : Number(value ?? 0);
  }

  private schedulePersist(): void {
    if (this.closed) {
      throw new Error("Local database is closed.");
    }
    this.dirty = true;
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this.flush();
      } catch (error) {
        // Keep dirty=true so an explicit flush (including shutdown) can retry.
        console.error("Failed to persist the local Chaq database.", error);
      }
    }, this.persistDelayMs);
    this.persistTimer.unref?.();
  }

  private cancelPersistTimer(): void {
    if (!this.persistTimer) {
      return;
    }
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }
}

function normalizePersistDelay(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PERSIST_DELAY_MS;
  }
  if (!Number.isFinite(value)) {
    throw new Error("persistDelayMs must be a finite number.");
  }
  return Math.max(0, Math.trunc(value));
}

function databasePaths(dbPath: string) {
  return {
    primary: dbPath,
    temporary: `${dbPath}.tmp`,
    backup: `${dbPath}.bak`,
    backupTemporary: `${dbPath}.bak.tmp`
  };
}

function recoverDatabaseFile(SQL: SqlJsStatic, dbPath: string): { bytes: Buffer | null } {
  const paths = databasePaths(dbPath);
  const primary = readValidDatabaseCandidate(SQL, paths.primary);
  const temporary = readValidDatabaseCandidate(SQL, paths.temporary);

  // A valid .tmp is a completely written, fsynced generation whose final rename
  // was interrupted. It is therefore the write-ahead source of truth.
  if (temporary) {
    promoteTemporaryDatabaseFile(paths.primary, Boolean(primary));
    safeUnlink(paths.backupTemporary);
    return { bytes: temporary.bytes };
  }

  if (primary) {
    safeUnlink(paths.temporary);
    safeUnlink(paths.backupTemporary);
    return { bytes: primary.bytes };
  }

  const backup = readValidDatabaseCandidate(SQL, paths.backupTemporary)
    ?? readValidDatabaseCandidate(SQL, paths.backup);
  if (backup) {
    persistDatabaseFile(paths.primary, backup.bytes, false);
    safeUnlink(paths.backupTemporary);
    return { bytes: backup.bytes };
  }

  const artifactsExist = [paths.primary, paths.temporary, paths.backup, paths.backupTemporary].some(existsSync);
  if (artifactsExist) {
    throw new Error(
      `The local database and its recovery files are unreadable: ${dbPath}. `
      + "Keep these files for manual recovery before starting Chaq again."
    );
  }
  return { bytes: null };
}

function readValidDatabaseCandidate(SQL: SqlJsStatic, path: string): DatabaseCandidate | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const bytes = readFileSync(path);
    if (!hasSqliteHeader(bytes)) {
      return null;
    }
    const candidate = new SQL.Database(bytes);
    try {
      const check = candidate.exec("pragma quick_check");
      if (check[0]?.values[0]?.[0] !== "ok") {
        return null;
      }
    } finally {
      candidate.close();
    }
    return { bytes };
  } catch {
    return null;
  }
}

function hasSqliteHeader(bytes: Uint8Array): boolean {
  const signature = "SQLite format 3\0";
  if (bytes.byteLength < signature.length) {
    return false;
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function persistDatabaseFile(dbPath: string, bytes: Buffer, backupExisting = true): void {
  const paths = databasePaths(dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  writeAndSync(paths.temporary, bytes);

  promoteTemporaryDatabaseFile(dbPath, backupExisting, false);
}

function promoteTemporaryDatabaseFile(
  dbPath: string,
  backupExisting: boolean,
  syncTemporary = true
): void {
  const paths = databasePaths(dbPath);
  if (syncTemporary) {
    syncFile(paths.temporary);
  }

  if (backupExisting && existsSync(paths.primary)) {
    writeAndSync(paths.backupTemporary, readFileSync(paths.primary));
    replaceFile(paths.backupTemporary, paths.backup);
  }

  replaceFile(paths.temporary, paths.primary);
  syncDirectory(dirname(dbPath));
}

function syncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeAndSync(path: string, bytes: Uint8Array): void {
  const descriptor = openSync(path, "w", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      if (written === 0) {
        throw new Error(`Could not finish writing ${path}.`);
      }
      offset += written;
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceFile(source: string, target: string): void {
  try {
    renameSync(source, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!existsSync(target) || !["EEXIST", "EPERM", "EACCES"].includes(code ?? "")) {
      throw error;
    }
  }

  // Windows can reject replacing an existing destination. The previous primary is
  // already durable in .bak, so removing it still leaves a recoverable crash state.
  unlinkSync(target);
  renameSync(source, target);
}

function syncDirectory(path: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (error) {
    // Windows does not consistently allow fsync on directory handles.
    if (process.platform !== "win32") {
      throw error;
    }
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isDuplicateColumnError(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^duplicate column name:\\s*${escaped}$`, "i").test(error.message.trim());
}

function defaultAutoSettings(skillId: string): SkillAutoMessageSettings {
  return {
    skillId,
    enabled: false,
    mode: "fixed",
    fixedPeriod: "day",
    fixedCount: 1,
    randomTokenLimit: 1000,
    randomUnlimited: false,
    doNotDisturb: false,
    lastSyncedAt: null,
    updatedAt: new Date().toISOString()
  };
}
