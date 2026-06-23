import assert from "node:assert/strict";
import test from "node:test";
import { providerKinds, userModelPresets } from "./provider-presets";

test("every model vendor has a selectable form preset", () => {
  assert.equal(providerKinds.length, 8);
  for (const kind of providerKinds) {
    assert.equal(userModelPresets[kind].kind, kind);
    assert.ok(userModelPresets[kind].name.length > 0);
    assert.ok(userModelPresets[kind].contextWindow > 0);
  }
});

test("known vendors switch URL and model together", () => {
  const knownKinds = providerKinds.filter((kind) => kind !== "custom");
  for (const kind of knownKinds) {
    const preset = userModelPresets[kind];
    assert.ok(preset.baseUrl.length > 0, `${kind} requires a Base URL`);
    assert.ok(preset.defaultModel.length > 0, `${kind} requires a default model`);
    assert.ok(preset.modelLabel.length > 0, `${kind} requires a model label`);
  }
  assert.equal(new Set(knownKinds.map((kind) => userModelPresets[kind].baseUrl)).size, knownKinds.length);
});

test("embedding-capable presets expose an embedding model", () => {
  assert.equal(userModelPresets.openai.embeddingModel, "text-embedding-3-small");
  assert.equal(userModelPresets.google.embeddingModel, "text-embedding-004");
  assert.equal(userModelPresets.custom.embeddingModel, "");
});
