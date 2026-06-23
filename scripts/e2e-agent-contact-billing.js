const http = require("node:http");

const baseUrl = "http://127.0.0.1:24537/api";
const billingUser = process.env.CHAQ_E2E_BILLING_USER;
const billingPassword = process.env.CHAQ_E2E_BILLING_PASSWORD || "123456";

if (!billingUser) {
  throw new Error("Set CHAQ_E2E_BILLING_USER to an existing non-admin test account before running billing E2E.");
}

async function request(path, init = {}, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-session-token": token } : {}),
      ...init.headers
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

async function login(username, password = "123456") {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

async function waitFor(check, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

async function startMockModel() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") return res.writeHead(404).end();
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const input = JSON.parse(body || "{}");
      const content = JSON.stringify({
        reasonSummary: "Reply to the new contact.",
        actions: [{ type: "reply", content: "Contact and billing flow verified." }],
        reflection: "The caller funded this reply and the creator received the configured service fee."
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: `billing-${Date.now()}`,
        model: input.model || "chaq-billing-test",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
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
  const [adminLogin, userLogin, mock] = await Promise.all([login("admin"), login(billingUser, billingPassword), startMockModel()]);
  const adminToken = adminLogin.sessionToken;
  const userToken = userLogin.sessionToken;
  const providers = await request("/models/admin/providers", {}, adminToken);
  const provider = providers.find((item) => item.id === "demo-openai-compatible") || providers[0];
  if (!provider) throw new Error("A platform provider is required for billing E2E.");
  const model = provider.models[0]?.id;
  if (!model) throw new Error("The platform provider has no configured model.");
  const suffix = Date.now().toString(36);
  let agent;

  try {
    await request("/models/admin/providers", {
      method: "POST",
      body: JSON.stringify(providerPayload(provider, {
        baseUrl: mock.baseUrl,
        apiKey: "chaq-e2e-key",
        enabled: true,
        promptTokenPrice: 0.01,
        completionTokenPrice: 0.01
      }))
    }, adminToken);

    agent = await request("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Billing E2E Agent",
        handle: `billing-${suffix}`,
        tagline: "Cross-account billing validation",
        persona: "A concise validation agent.",
        tone: "Direct.",
        identity: { traits: ["reliable"], interests: ["testing"] },
        values: ["clarity"],
        worldview: "Observable behavior builds trust.",
        boundaries: "No external actions.",
        tags: ["e2e"],
        autonomyMode: "copilot",
        visibility: "public",
        serviceFee: 7,
        modelProviderId: provider.id,
        model,
        temperature: 0,
        initiative: 50,
        reflectionDepth: 1,
        scheduleEveryMinutes: 60,
        dailyTokenBudget: 1000,
        dailyActionBudget: 10
      })
    }, adminToken);

    const beforeUser = await request("/users/me", {}, userToken);
    const beforeAdmin = await request("/users/me", {}, adminToken);
    await request(`/agents/${agent.id}/contact`, { method: "POST", body: "{}" }, userToken);
    const conversation = await request(`/conversations/with-agent/${agent.id}`, { method: "POST", body: "{}" }, userToken);
    await request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Verify the public Agent billing flow." })
    }, userToken);

    await waitFor(async () => {
      const messages = await request(`/conversations/${conversation.id}/messages`, {}, userToken);
      return messages.some((message) => message.authorKind === "agent" && message.content.includes("billing flow verified"));
    });

    const afterUser = await request("/users/me", {}, userToken);
    const afterAdmin = await request("/users/me", {}, adminToken);
    const userDebit = beforeUser.tokenBalance - afterUser.tokenBalance;
    const adminCredit = afterAdmin.tokenBalance - beforeAdmin.tokenBalance;
    if (userDebit !== 8) throw new Error(`Expected caller debit 8, received ${userDebit}.`);
    if (adminCredit !== 7) throw new Error(`Expected creator credit 7, received ${adminCredit}.`);

    const contacts = await request("/agents/contacts", {}, userToken);
    if (!contacts.some((contact) => contact.agent.id === agent.id)) throw new Error("Agent contact was not persisted.");
    const discovered = await request(`/agents/discover?query=${encodeURIComponent(agent.handle)}`, {}, userToken);
    if (!discovered.some((item) => item.id === agent.id && item.isContact)) throw new Error("Agent discovery did not expose contact state.");
    const [userWallet, adminWallet] = await Promise.all([
      request("/users/me/wallet", {}, userToken),
      request("/users/me/wallet", {}, adminToken)
    ]);
    if (userWallet.serviceFeesPaid < 7) throw new Error("Caller wallet did not include the service fee.");
    const earning = adminWallet.agentEarnings.find((item) => item.agentId === agent.id);
    if (!earning || earning.amount !== 7) throw new Error("Creator wallet did not group the Agent earning.");
    console.log(JSON.stringify({ ok: true, agentId: agent.id, conversationId: conversation.id, userDebit, adminCredit, walletEarning: earning.amount }));
  } finally {
    if (agent) {
      await request(`/agents/${agent.id}`, { method: "POST", body: JSON.stringify({ status: "archived" }) }, adminToken).catch(() => undefined);
      await request(`/agents/${agent.id}/contact/remove`, { method: "POST", body: "{}" }, userToken).catch(() => undefined);
    }
    await request("/models/admin/providers", {
      method: "POST",
      body: JSON.stringify(providerPayload(provider))
    }, adminToken).catch(() => undefined);
    await new Promise((resolve) => mock.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
