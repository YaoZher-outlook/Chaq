const http = require("node:http");

const baseUrl = (process.env.CHAQ_E2E_SERVER_URL || "http://127.0.0.1:24537/api").replace(/\/$/, "");
const username = process.env.CHAQ_E2E_USERNAME || "admin";
const password = process.env.CHAQ_E2E_PASSWORD || "123456";
const providerId = process.env.CHAQ_E2E_PROVIDER_ID || null;
const model = process.env.CHAQ_E2E_MODEL || null;
const timeoutMs = Math.max(10_000, Number(process.env.CHAQ_E2E_TIMEOUT_MS || 90_000));
const useMockModel = process.env.CHAQ_E2E_MOCK_MODEL === "1";

if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
  throw new Error("Refusing to run the development Agent E2E test with NODE_ENV=production.");
}

async function request(path, init = {}, sessionToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...init.headers
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function waitFor(predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

async function startMockModel() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const input = JSON.parse(body || "{}");
      const content = JSON.stringify({
        reasonSummary: "Acknowledge the message and establish durable work context.",
        actions: [
          { type: "reply", content: "Agent runtime verified: I observed the conversation, made a plan, and completed my actions." },
          { type: "remember", memoryKind: "semantic", content: "The owner values concrete end-to-end verification.", salience: 0.8 },
          { type: "create_goal", title: "Maintain reliable Agent behavior", description: "Keep runtime behavior observable and testable.", priority: 80 },
          { type: "create_task", title: "Review the latest Agent run", description: "Inspect events and outcomes after execution.", priority: 70 },
          { type: "publish_post", content: "Finished a full observe, decide, act, and reflect cycle. Reliability grows from visible evidence.", mood: "focused", location: "Chaq lab" }
        ],
        reflection: "The full observe, decide, act, and reflect cycle completed successfully."
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: input.model || "chaq-e2e-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 240, completion_tokens: 160, total_tokens: 400 }
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock model did not bind to a TCP port.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

function providerPayload(provider, overrides = {}) {
  return {
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models: provider.models,
    enabled: provider.enabled,
    promptTokenPrice: provider.promptTokenPrice,
    completionTokenPrice: provider.completionTokenPrice,
    contextWindow: provider.contextWindow,
    ...overrides
  };
}

async function main() {
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  const token = login.sessionToken;
  let selectedProviderId = providerId;
  let selectedModel = model;
  let originalProvider = null;
  let mock = null;
  let agent = null;
  const suffix = Date.now().toString(36);
  try {
    if (useMockModel) {
      mock = await startMockModel();
      const providers = await request("/models/admin/providers", {}, token);
      originalProvider = selectedProviderId
        ? providers.find((provider) => provider.id === selectedProviderId)
        : providers.find((provider) => provider.enabled);
      if (!originalProvider) throw new Error("No model provider is available for the mock-model E2E test.");
      selectedProviderId = originalProvider.id;
      selectedModel = selectedModel || originalProvider.models[0]?.id;
      if (!selectedModel) throw new Error("The selected provider has no model.");
      await request("/models/admin/providers", {
        method: "POST",
        body: JSON.stringify(providerPayload(originalProvider, { baseUrl: mock.baseUrl, enabled: true }))
      }, token);
    }
    agent = await request("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Chaq E2E Agent",
        handle: `e2e-${suffix}`,
        avatarUrl: null,
        tagline: "Automated validation agent",
        biography: "",
        persona: "A careful validation agent.",
        tone: "Concise and direct.",
        values: ["reliability"],
        worldview: "Validate behavior through concrete evidence.",
        boundaries: "Do not perform external actions.",
        identity: { traits: ["careful"], interests: ["testing"] },
        tags: ["e2e"],
        autonomyMode: "copilot",
        visibility: "private",
        modelProviderId: selectedProviderId,
        model: selectedModel,
        temperature: 0.7,
        initiative: 50,
        reflectionDepth: 1,
        scheduleEveryMinutes: 60,
        dailyTokenBudget: 1000,
        dailyActionBudget: 10
      })
    }, token);
    const conversation = await request(`/conversations/with-agent/${agent.id}`, {
      method: "POST",
      body: "{}"
    }, token);
    await request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Confirm that the Agent worker received this message." })
    }, token);

    const result = await waitFor(async () => {
      const [detail, messages] = await Promise.all([
        request(`/agents/${agent.id}`, {}, token),
        request(`/conversations/${conversation.id}/messages`, {}, token)
      ]);
      const failed = detail.recentRuns.find((run) => run.status === "failed" || run.status === "cancelled");
      if (failed) throw new Error(`Agent run ${failed.status}: ${failed.error || "unknown error"}`);
      const completed = detail.recentRuns.some((run) => run.status === "completed");
      const agentReply = messages.find((message) => message.authorKind === "agent" && message.authorId === agent.id);
      return completed && agentReply ? { detail, messages, agentReply } : null;
    }, timeoutMs);

    const profile = await request(`/agents/${agent.id}/profile`, {}, token);
    if (!profile.posts.some((post) => post.content.includes("visible evidence"))) {
      throw new Error("Agent completed its run without publishing the planned profile post.");
    }

    console.log(JSON.stringify({
      ok: true,
      modelConfigured: Boolean(selectedProviderId && selectedModel),
      mockModel: useMockModel,
      agentId: agent.id,
      completedRuns: result.detail.recentRuns.filter((run) => run.status === "completed").length,
      eventCount: result.detail.recentEvents.length,
      messageCount: result.messages.length,
      memoryCount: result.detail.memories.length,
      goalCount: result.detail.goals.length,
      taskCount: result.detail.tasks.length,
      profilePostCount: profile.posts.length,
      replyPreview: result.agentReply.content.slice(0, 120)
    }, null, 2));
  } finally {
    if (agent) {
      await request(`/agents/${agent.id}`, {
        method: "POST",
        body: JSON.stringify({ status: "archived" })
      }, token).catch(() => undefined);
    }
    if (originalProvider) {
      await request("/models/admin/providers", {
        method: "POST",
        body: JSON.stringify(providerPayload(originalProvider))
      }, token).catch(() => undefined);
    }
    if (mock) await new Promise((resolve) => mock.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
