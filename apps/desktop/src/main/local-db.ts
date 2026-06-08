import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import initSqlJs, { Database } from "sql.js";
import type {
  ChatMessage,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  SkillVersionSnapshot,
  UserModelConfigPublic
} from "@chaq/shared";
import type { SecretModelConfig } from "./model-adapters";

type CryptoCodec = {
  encrypt(value: string): string;
  decrypt(value: string): string;
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
  kind: UserModelConfigPublic["kind"];
  name: string;
  base_url: string;
  api_key_ciphertext: string;
  default_model: string;
  created_at: string;
  updated_at: string;
};

export class LocalDatabase {
  private constructor(
    private readonly dbPath: string,
    private readonly codec: CryptoCodec,
    private readonly db: Database
  ) {
    this.init();
  }

  static async create(dbPath: string, codec: CryptoCodec): Promise<LocalDatabase> {
    const SQL = await initSqlJs();
    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    return new LocalDatabase(dbPath, codec, db);
  }

  listSkills(): SkillSummary[] {
    const rows = this.all<SkillRow>("select * from skills order by updated_at desc");
    return rows.map((row) => this.toSkill(row));
  }

  getSkill(id: string): SkillSummary | null {
    const row = this.get<SkillRow>("select * from skills where id = ?", [id]);
    return row ? this.toSkill(row) : null;
  }

  createSkill(skill: SkillDraft, sourceKind: SkillSourceKind = "manual"): SkillSummary {
    const now = new Date().toISOString();
    const skillId = randomUUID();
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

  listUserModelConfigs(): UserModelConfigPublic[] {
    const rows = this.all<Omit<ModelConfigRow, "api_key_ciphertext">>(
      "select id, kind, name, base_url, default_model, created_at, updated_at from user_model_configs order by updated_at desc"
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  saveUserModelConfig(input: {
    id?: string;
    kind: UserModelConfigPublic["kind"];
    name: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
  }): UserModelConfigPublic {
    const now = new Date().toISOString();
    const id = input.id || randomUUID();
    const ciphertext = this.codec.encrypt(input.apiKey);
    this.run(
      `insert into user_model_configs (id, kind, name, base_url, api_key_ciphertext, default_model, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         kind = excluded.kind,
         name = excluded.name,
         base_url = excluded.base_url,
         api_key_ciphertext = excluded.api_key_ciphertext,
         default_model = excluded.default_model,
         updated_at = excluded.updated_at`
    , [id, input.kind, input.name, input.baseUrl.replace(/\/$/, ""), ciphertext, input.defaultModel, now, now]);
    return this.listUserModelConfigs().find((config) => config.id === id)!;
  }

  deleteUserModelConfig(id: string): void {
    this.run("delete from user_model_configs where id = ?", [id]);
  }

  getSecretModelConfig(id: string): SecretModelConfig {
    const row = this.get<ModelConfigRow>("select * from user_model_configs where id = ?", [id]);
    if (!row) {
      throw new Error("User model config not found.");
    }
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      apiKey: this.codec.decrypt(row.api_key_ciphertext),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private init(): void {
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
        kind text not null,
        name text not null,
        base_url text not null,
        api_key_ciphertext text not null,
        default_model text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_messages_skill on messages(skill_id, created_at);
      create index if not exists idx_versions_skill on skill_versions(skill_id, version);
    `);
    this.persist();
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
      this.persist();
    }
  }

  private transaction(action: () => void): void {
    this.db.run("begin");
    try {
      action();
      this.db.run("commit");
      this.persist();
    } catch (error) {
      this.db.run("rollback");
      throw error;
    }
  }

  private persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
