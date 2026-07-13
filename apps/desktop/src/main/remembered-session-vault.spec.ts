import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RememberedSessionVault, type SessionVaultCodec } from "./remembered-session-vault";

const codec: SessionVaultCodec = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
  decryptString: (value) => [...value.toString("utf8")].reverse().join("")
};

function withVault(run: (vault: RememberedSessionVault, filePath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "chaq-session-vault-"));
  const filePath = join(root, "vault.json");
  try {
    run(new RememberedSessionVault(filePath, codec), filePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("remembered sessions are encrypted at rest and can be deleted", () => {
  withVault((vault, filePath) => {
    const session = { accountId: "account-1", sessionToken: "secret-session-token", expiresAt: "2999-01-01T00:00:00.000Z" };
    vault.save(session);
    assert.deepEqual(vault.get(session.accountId), session);
    assert.doesNotMatch(readFileSync(filePath, "utf8"), /secret-session-token/);
    vault.delete(session.accountId);
    assert.equal(vault.get(session.accountId), null);
  });
});

test("repeated saves durably replace the same account credential", () => {
  withVault((vault, filePath) => {
    vault.save({ accountId: "account-1", sessionToken: "first-token", expiresAt: "2999-01-01T00:00:00.000Z" });
    vault.save({ accountId: "account-1", sessionToken: "second-token", expiresAt: "2999-01-01T00:00:00.000Z" });
    assert.equal(vault.get("account-1")?.sessionToken, "second-token");
    assert.doesNotMatch(readFileSync(filePath, "utf8"), /first-token|second-token/);
    assert.equal(JSON.parse(readFileSync(filePath, "utf8")).sessions.length, 1);
  });
});

test("recovers an interrupted valid replacement before falling back to backup", () => {
  withVault((vault, filePath) => {
    vault.save({ accountId: "account-1", sessionToken: "old-token", expiresAt: "2999-01-01T00:00:00.000Z" });
    const replacement = {
      version: 1,
      sessions: [{
        accountId: "account-1",
        expiresAt: "2999-01-01T00:00:00.000Z",
        ciphertext: codec.encryptString("new-token").toString("base64")
      }]
    };
    writeFileSync(`${filePath}.tmp`, JSON.stringify(replacement), "utf8");
    writeFileSync(filePath, "corrupt", "utf8");
    assert.equal(vault.get("account-1")?.sessionToken, "new-token");
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), replacement);
  });
});

test("a valid interrupted replacement wins over an older valid primary", () => {
  withVault((vault, filePath) => {
    vault.save({ accountId: "account-1", sessionToken: "old-token", expiresAt: "2999-01-01T00:00:00.000Z" });
    const replacement = {
      version: 1,
      sessions: [{
        accountId: "account-1",
        expiresAt: "2999-01-01T00:00:00.000Z",
        ciphertext: codec.encryptString("new-token").toString("base64")
      }]
    };
    writeFileSync(`${filePath}.tmp`, JSON.stringify(replacement), "utf8");
    assert.equal(vault.get("account-1")?.sessionToken, "new-token");
  });
});

test("a failed commit preserves the encrypted temporary vault for recovery", () => {
  const root = mkdtempSync(join(tmpdir(), "chaq-session-vault-failure-"));
  const filePath = join(root, "vault.json");
  const session = { accountId: "account-1", sessionToken: "recoverable-token", expiresAt: "2999-01-01T00:00:00.000Z" };
  try {
    // A directory at the destination forces the commit to fail after the
    // complete encrypted temporary file has already been fsynced.
    mkdirSync(filePath);
    const vault = new RememberedSessionVault(filePath, codec);
    assert.throws(() => vault.save(session));
    assert.equal(existsSync(`${filePath}.tmp`), true);
    assert.doesNotMatch(readFileSync(`${filePath}.tmp`, "utf8"), /recoverable-token/);

    rmSync(filePath, { recursive: true, force: true });
    const recovered = new RememberedSessionVault(filePath, codec);
    assert.deepEqual(recovered.get(session.accountId), session);
    assert.equal(existsSync(`${filePath}.tmp`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remembered session vault keeps only the six newest accounts", () => {
  withVault((vault) => {
    for (let index = 0; index < 7; index += 1) {
      vault.save({ accountId: `account-${index}`, sessionToken: `token-${index}`, expiresAt: "2999-01-01T00:00:00.000Z" });
    }
    assert.equal(vault.get("account-0"), null);
    assert.equal(vault.get("account-6")?.sessionToken, "token-6");
  });
});

test("expired, corrupt, and unavailable encrypted sessions fail closed", () => {
  withVault((vault, filePath) => {
    vault.save({ accountId: "expired", sessionToken: "expired-token", expiresAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(vault.get("expired"), null);
    writeFileSync(filePath, "not-json", "utf8");
    assert.equal(vault.get("missing"), null);
    const unavailable = new RememberedSessionVault(filePath, { ...codec, isEncryptionAvailable: () => false });
    assert.throws(() => unavailable.save({ accountId: "a", sessionToken: "b", expiresAt: "2999-01-01T00:00:00.000Z" }), /安全存储不可用/);
  });
});
