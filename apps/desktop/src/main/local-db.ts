import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import initSqlJs, { Database } from "sql.js";
import type {
  ChatMessage,
  SkillAutoMessageSettings,
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
    try {
      this.run("alter table user_model_configs add column user_id text not null default 'local'");
    } catch {
      // Existing local databases already have this column.
    }
    try {
      this.run("alter table user_model_configs add column embedding_model text");
    } catch {
      // Existing local databases already have this column.
    }
    this.run("create index if not exists idx_user_model_configs_user on user_model_configs(user_id, updated_at)");
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
