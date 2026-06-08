import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Cpu,
  Download,
  Globe,
  Image as ImageIcon,
  Lock,
  LogOut,
  MessageCircle,
  Minimize2,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Star,
  Store,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Upload,
  User,
  X
} from "lucide-react";
import type {
  ChatMessage,
  ImportPreview,
  MarketplaceComment,
  MarketplaceSkill,
  ModelProviderPublic,
  ProviderKind,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  UserModelConfigPublic
} from "@chaq/shared";
import { api, type LoginUser, type UserSettings } from "./lib/api";
import { heuristicDraftFromMessages, parseImport } from "./lib/importParser";
import coverUrl from "./assets/chaq-cover.png";
import "./styles.css";

type View = "chat" | "import" | "market" | "models" | "admin" | "settings";
type ModelMode = "cloud" | "user";

type RememberedAccount = {
  sessionToken: string;
  expiresAt: string;
  user: LoginUser;
  settings: UserSettings;
};

const blankSkill: SkillDraft = {
  name: "新的 Skill",
  avatarUrl: coverUrl,
  description: "一个可以聊天、被导入和分享的虚拟好友。",
  persona: "温和、清醒、会接住用户的话，并主动帮助用户拆解问题。",
  tone: "自然、简洁，像熟悉的人一样回应。",
  knowledge: "",
  boundaries: "不泄露导入资料，不冒充真实本人做现实承诺。",
  examples: [{ user: "我今天有点累。", assistant: "先把节奏放慢一点。你想先讲发生了什么，还是只想安静待一会儿？" }],
  tags: ["自建"]
};

const providerKinds: ProviderKind[] = ["openai", "anthropic", "google", "deepseek", "dashscope", "zhipu", "ollama", "custom"];

function App(): JSX.Element {
  const [auth, setAuth] = useState<{ user: LoginUser; settings: UserSettings } | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [rememberMe, setRememberMe] = useState(true);
  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedAccount[]>([]);
  const [selectedRememberedId, setSelectedRememberedId] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [booting, setBooting] = useState(true);

  const [view, setView] = useState<View>("chat");
  const [notice, setNotice] = useState("准备就绪");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(blankSkill);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("cloud");
  const [cloudProviders, setCloudProviders] = useState<ModelProviderPublic[]>([]);
  const [cloudProviderId, setCloudProviderId] = useState("");
  const [cloudModel, setCloudModel] = useState("");
  const [userModels, setUserModels] = useState<UserModelConfigPublic[]>([]);
  const [userModelId, setUserModelId] = useState("");
  const [skillSearch, setSkillSearch] = useState("");

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreferredName, setImportPreferredName] = useState("");

  const [marketItems, setMarketItems] = useState<MarketplaceSkill[]>([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [comments, setComments] = useState<MarketplaceComment[]>([]);
  const [commentText, setCommentText] = useState("");

  const [userModelForm, setUserModelForm] = useState({
    id: "",
    kind: "openai" as ProviderKind,
    name: "我的模型",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-4.1-mini"
  });
  const [providerForm, setProviderForm] = useState({
    id: "",
    kind: "openai" as ProviderKind,
    name: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelId: "gpt-4.1-mini",
    modelLabel: "GPT 4.1 Mini",
    contextWindow: 128000,
    promptTokenPrice: 0.001,
    completionTokenPrice: 0.004,
    enabled: true
  });
  const [adminProviders, setAdminProviders] = useState<ModelProviderPublic[]>([]);

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? null;
  const selectedProvider = cloudProviders.find((provider) => provider.id === cloudProviderId);
  const selectedMarket = marketItems.find((item) => item.id === selectedMarketId) ?? null;
  const selectedRemembered = rememberedAccounts.find((account) => account.user.id === selectedRememberedId) ?? rememberedAccounts[0] ?? null;
  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase().includes(q));
  }, [skillSearch, skills]);
  const isAdmin = auth?.user.role === "ADMIN";

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    if (auth) {
      applySettings(auth.settings);
    }
  }, [auth?.settings]);

  useEffect(() => {
    if (!selectedSkillId && skills[0]) {
      setSelectedSkillId(skills[0].id);
    }
  }, [skills, selectedSkillId]);

  useEffect(() => {
    if (selectedSkill) {
      setDraft(skillToDraft(selectedSkill));
      void loadMessages(selectedSkill.id);
    } else {
      setDraft(blankSkill);
      setMessages([]);
    }
  }, [selectedSkillId]);

  useEffect(() => {
    if (!cloudProviderId && cloudProviders[0]) {
      setCloudProviderId(cloudProviders[0].id);
      setCloudModel(cloudProviders[0].models[0]?.id ?? "");
    }
  }, [cloudProviders, cloudProviderId]);

  useEffect(() => {
    if (selectedProvider && !selectedProvider.models.some((model) => model.id === cloudModel)) {
      setCloudModel(selectedProvider.models[0]?.id ?? "");
    }
  }, [selectedProvider, cloudModel]);

  async function restoreSession(): Promise<void> {
    await window.chaq.window.setMode("login");
    let remembered = loadRememberedAccounts();
    const legacyToken = localStorage.getItem("chaq.sessionToken");
    if (legacyToken && !remembered.some((account) => account.sessionToken === legacyToken)) {
      try {
        const [user, settings] = await Promise.all([api.me(), api.settings()]);
        remembered = upsertRememberedAccount(remembered, {
          sessionToken: legacyToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          user,
          settings
        });
        saveRememberedAccounts(remembered);
      } catch {
        localStorage.removeItem("chaq.sessionToken");
      }
    }
    localStorage.removeItem("chaq.sessionToken");
    sessionStorage.removeItem("chaq.sessionToken");
    setRememberedAccounts(remembered);
    setSelectedRememberedId(remembered[0]?.user.id ?? null);
    setShowAccountForm(remembered.length === 0);
    setBooting(false);
  }

  async function loginWithRemembered(): Promise<void> {
    if (!selectedRemembered) {
      setShowAccountForm(true);
      return;
    }
    setLoginError("");
    setBusy(true);
    try {
      sessionStorage.setItem("chaq.sessionToken", selectedRemembered.sessionToken);
      const [user, settings] = await Promise.all([api.me(), api.settings()]);
      const updated = upsertRememberedAccount(rememberedAccounts, { ...selectedRemembered, user, settings });
      setRememberedAccounts(updated);
      saveRememberedAccounts(updated);
      setAuth({ user, settings });
      await window.chaq.window.setMode("main");
      await window.chaq.window.setOpacity(settings.windowOpacity);
      await refreshAll();
    } catch (error) {
      localStorage.removeItem("chaq.sessionToken");
      sessionStorage.removeItem("chaq.sessionToken");
      const next = rememberedAccounts.filter((account) => account.user.id !== selectedRemembered.user.id);
      setRememberedAccounts(next);
      saveRememberedAccounts(next);
      setSelectedRememberedId(next[0]?.user.id ?? null);
      setShowAccountForm(true);
      setLoginError(`登录状态已失效，请重新输入账号密码。${messageOf(error)}`);
    } finally {
      setBooting(false);
      setBusy(false);
    }
  }

  async function login(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!showAccountForm && selectedRemembered) {
      await loginWithRemembered();
      return;
    }
    setLoginError("");
    setBusy(true);
    try {
      const result = await api.login({ username: loginForm.username, password: loginForm.password });
      sessionStorage.setItem("chaq.sessionToken", result.sessionToken);
      if (rememberMe) {
        const next = upsertRememberedAccount(rememberedAccounts, {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          user: result.user,
          settings: result.settings
        });
        setRememberedAccounts(next);
        setSelectedRememberedId(result.user.id);
        saveRememberedAccounts(next);
      }
      setAuth({ user: result.user, settings: result.settings });
      await window.chaq.window.setMode("main");
      await window.chaq.window.setOpacity(result.settings.windowOpacity);
      await refreshAll();
    } catch (error) {
      setLoginError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<void> {
    localStorage.removeItem("chaq.sessionToken");
    sessionStorage.removeItem("chaq.sessionToken");
    setAuth(null);
    setSkills([]);
    setSelectedSkillId(null);
    setShowAccountForm(rememberedAccounts.length === 0);
    await window.chaq.window.setMode("login");
  }

  async function refreshAll(): Promise<void> {
    await Promise.allSettled([refreshLocal(), refreshRemote(), refreshMarketplace(), refreshUserModels()]);
  }

  async function refreshLocal(): Promise<void> {
    const list = await window.chaq.skills.list();
    if (list.length === 0) {
      const created = await window.chaq.skills.create(blankSkill, "manual");
      setSkills([created]);
      setSelectedSkillId(created.id);
      return;
    }
    setSkills(list);
  }

  async function refreshRemote(): Promise<void> {
    try {
      const [user, settings, providers] = await Promise.all([api.me(), api.settings(), api.providers()]);
      setAuth({ user, settings });
      setCloudProviders(providers);
    } catch (error) {
      setNotice(`后端未连接：${messageOf(error)}`);
    }
  }

  async function refreshMarketplace(): Promise<void> {
    try {
      setMarketItems(await api.marketplace(marketQuery));
    } catch {
      setMarketItems([]);
    }
  }

  async function refreshUserModels(): Promise<void> {
    const models = await window.chaq.models.listUser();
    setUserModels(models);
    if (!userModelId && models[0]) setUserModelId(models[0].id);
  }

  async function loadMessages(skillId: string): Promise<void> {
    setMessages(await window.chaq.messages.list(skillId));
  }

  async function addSkill(): Promise<void> {
    const created = await window.chaq.skills.create({ ...blankSkill, name: `Skill ${skills.length + 1}` }, "manual");
    await refreshLocal();
    setSelectedSkillId(created.id);
    setView("chat");
  }

  async function saveSkill(sourceKind: SkillSourceKind = "manual"): Promise<void> {
    setBusy(true);
    try {
      const saved = selectedSkill
        ? await window.chaq.skills.update(selectedSkill.id, draft, sourceKind)
        : await window.chaq.skills.create(draft, sourceKind);
      await refreshLocal();
      setSelectedSkillId(saved.id);
      setNotice("Skill 已保存");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (!selectedSkill || !composer.trim() || busy) return;
    setBusy(true);
    const content = composer.trim();
    setComposer("");
    try {
      const userMessage = await window.chaq.messages.add({ skillId: selectedSkill.id, role: "user", content });
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      if (modelMode === "cloud") {
        if (!cloudProviderId || !cloudModel) throw new Error("请先在后台启用云端模型。");
        const response = await api.cloudChat({
          providerId: cloudProviderId,
          model: cloudModel,
          skill: draft,
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text }))
        });
        const assistant = await window.chaq.messages.add({
          skillId: selectedSkill.id,
          role: "assistant",
          content: response.content,
          modelLabel: response.modelLabel
        });
        setMessages([...nextMessages, assistant]);
        setAuth((current) => current ? { ...current, user: { ...current.user, tokenBalance: response.balanceAfter } } : current);
      } else {
        if (!userModelId) throw new Error("请先配置自己的模型。");
        const response = await window.chaq.models.userChat({
          configId: userModelId,
          skill: draft,
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text }))
        });
        const assistant = await window.chaq.messages.add({
          skillId: selectedSkill.id,
          role: "assistant",
          content: response.content,
          modelLabel: response.modelLabel
        });
        setMessages([...nextMessages, assistant]);
      }
    } catch (error) {
      const assistant = await window.chaq.messages.add({
        skillId: selectedSkill.id,
        role: "assistant",
        content: `调用失败：${messageOf(error)}`,
        modelLabel: "system"
      });
      setMessages((current) => [...current, assistant]);
    } finally {
      setBusy(false);
    }
  }

  async function openImportFile(): Promise<void> {
    const file = await window.chaq.imports.openFile();
    if (!file) return;
    setImportPreview(parseImport(file.fileName, file.content));
  }

  async function distillImport(): Promise<void> {
    if (!importPreview) return;
    const selected = importPreview.messages.filter((message) => message.selected);
    setBusy(true);
    try {
      let nextDraft: SkillDraft;
      try {
        const response = await api.distill({
          sourceKind: importPreview.sourceKind,
          messages: selected,
          preferredName: importPreferredName || undefined,
          ...(modelMode === "cloud" && cloudProviderId && cloudModel ? { providerId: cloudProviderId, model: cloudModel } : {})
        });
        nextDraft = response.draft;
      } catch {
        nextDraft = heuristicDraftFromMessages(selected, importPreview.sourceKind, importPreferredName);
      }
      await window.chaq.imports.save({
        sourceKind: importPreview.sourceKind,
        fileName: importPreview.fileName,
        messages: selected,
        warnings: importPreview.warnings,
        draft: nextDraft
      });
      const created = await window.chaq.skills.create(nextDraft, importPreview.sourceKind);
      await refreshLocal();
      setSelectedSkillId(created.id);
      setView("chat");
      setNotice("已从导入内容生成 Skill");
    } finally {
      setBusy(false);
    }
  }

  async function publishSkill(): Promise<void> {
    if (!selectedSkill) return;
    await api.publish(skillToDraft(selectedSkill));
    await refreshMarketplace();
    setView("market");
    setNotice("已发布到聊天广场");
  }

  async function selectMarket(id: string): Promise<void> {
    setSelectedMarketId(id);
    setComments(await api.comments(id).catch(() => []));
  }

  async function importMarketSkill(id: string): Promise<void> {
    const response = await api.importMarketplaceSkill(id);
    const created = await window.chaq.skills.create(response.skill, "manual");
    await refreshLocal();
    setSelectedSkillId(created.id);
    setView("chat");
  }

  async function addComment(): Promise<void> {
    if (!selectedMarket || !commentText.trim()) return;
    const created = await api.addComment(selectedMarket.id, commentText.trim());
    setComments([created, ...comments]);
    setCommentText("");
    await refreshMarketplace();
  }

  async function saveUserModel(): Promise<void> {
    const saved = await window.chaq.models.saveUser(userModelForm);
    setUserModelId(saved.id);
    await refreshUserModels();
  }

  async function saveAdminProvider(): Promise<void> {
    await api.saveProvider({
      id: providerForm.id || undefined,
      kind: providerForm.kind,
      name: providerForm.name,
      baseUrl: providerForm.baseUrl,
      apiKey: providerForm.apiKey,
      models: [{ id: providerForm.modelId, label: providerForm.modelLabel, contextWindow: Number(providerForm.contextWindow) }],
      enabled: providerForm.enabled,
      promptTokenPrice: Number(providerForm.promptTokenPrice),
      completionTokenPrice: Number(providerForm.completionTokenPrice),
      contextWindow: Number(providerForm.contextWindow)
    });
    setAdminProviders(await api.adminProviders());
    await refreshRemote();
  }

  async function saveSettings(next: Partial<UserSettings>): Promise<void> {
    const saved = await api.saveSettings(next);
    setAuth((current) => current ? { ...current, settings: saved } : current);
    applySettings(saved);
  }

  function applySettings(settings: UserSettings): void {
    document.documentElement.dataset.theme = settings.theme === "system" ? "dark" : settings.theme;
    document.documentElement.style.setProperty("--window-opacity", String(settings.backgroundOpacity));
    void window.chaq.window.setOpacity(settings.windowOpacity);
  }

  if (booting) {
    return <div className="boot-screen">Chaq</div>;
  }

  if (!auth) {
    return (
      <div className="login-window">
        <WindowButtons compact />
        <div className="login-cover" style={{ backgroundImage: `url(${coverUrl})` }} />
        <div className="login-top-brand">
          <div className="app-logo small">C</div>
          <strong>Chaq</strong>
        </div>
        <div className="remembered-stage">
          <div className="remembered-avatars">
            {rememberedAccounts.map((account) => (
              <button
                key={account.user.id}
                className={account.user.id === selectedRemembered?.user.id ? "remembered-avatar active" : "remembered-avatar"}
                onClick={() => {
                  setSelectedRememberedId(account.user.id);
                  setShowAccountForm(false);
                  setLoginError("");
                }}
                title={account.user.displayName}
              >
                <img src={account.user.avatarUrl || coverUrl} alt="" />
              </button>
            ))}
            {rememberedAccounts.length === 0 && <div className="remembered-placeholder"><User size={42} /></div>}
          </div>
          <strong>{selectedRemembered && !showAccountForm ? selectedRemembered.user.displayName : "登录 Chaq"}</strong>
        </div>
        <form className="login-card" onSubmit={(event) => void login(event)}>
          {showAccountForm || !selectedRemembered ? (
            <>
              <label><User size={16} />账号<input value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} autoFocus /></label>
              <label><Lock size={16} />密码<input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} /></label>
              <label className="remember-check"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />记住我</label>
            </>
          ) : (
            <div className="remembered-summary">
              <span>{selectedRemembered.user.username}</span>
              <small>{roleLabel(selectedRemembered.user.role)}</small>
            </div>
          )}
          {loginError && <div className="login-error">{loginError}</div>}
          <button className="primary-button" disabled={busy}>{busy ? "登录中..." : "登录"}</button>
          {!showAccountForm && selectedRemembered ? (
            <button type="button" className="text-button" onClick={() => { setShowAccountForm(true); setLoginError(""); }}>切换账号</button>
          ) : rememberedAccounts.length > 0 ? (
            <button type="button" className="text-button" onClick={() => { setShowAccountForm(false); setLoginError(""); }}>返回已记住账号</button>
          ) : null}
          <div className="login-hints"><span>Chaq Skill Messenger</span></div>
        </form>
      </div>
    );
  }

  return (
    <div
      className="qq-shell"
      style={{
        backgroundImage: `linear-gradient(rgba(18,18,24,var(--window-opacity)), rgba(18,18,24,var(--window-opacity))), url(${auth.settings.backgroundUrl || coverUrl})`
      }}
    >
      <TitleBar user={auth.user} onLogout={() => void logout()} />
      <div className="app-body">
        <aside className="icon-rail">
          <div className="avatar"><img src={auth.user.avatarUrl || coverUrl} alt="" /><span /></div>
          <RailButton active={view === "chat"} title="聊天" icon={<MessageCircle />} onClick={() => setView("chat")} />
          <RailButton active={view === "import"} title="导入" icon={<Upload />} onClick={() => setView("import")} />
          <RailButton active={view === "market"} title="广场" icon={<Store />} onClick={() => setView("market")} />
          <RailButton active={view === "models"} title="模型" icon={<Cpu />} onClick={() => setView("models")} />
          {isAdmin && <RailButton active={view === "admin"} title="后台" icon={<ShieldCheck />} onClick={() => setView("admin")} />}
          <div className="rail-spacer" />
          <RailButton active={view === "settings"} title="设置" icon={<Settings />} onClick={() => setView("settings")} />
        </aside>

        <aside className="skill-column">
          <div className="search-box"><Search size={16} /><input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="搜索 Skill" /></div>
          <button className="add-skill" onClick={() => void addSkill()}><Plus size={18} />添加 Skill</button>
          <div className="skill-list-qq">
            {filteredSkills.map((skill) => (
              <button key={skill.id} className={skill.id === selectedSkillId ? "skill-card active" : "skill-card"} onClick={() => { setSelectedSkillId(skill.id); setView("chat"); }}>
                <img src={skill.avatarUrl || coverUrl} alt="" />
                <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <main className="content">
          {view === "chat" && (
            <section className="chat-view">
              <header className="chat-title">
                <div><h2>{draft.name}</h2><p>{draft.description}</p></div>
                <div className="chat-actions">
                  <select value={modelMode} onChange={(event) => setModelMode(event.target.value as ModelMode)}>
                    <option value="cloud">平台云模型</option>
                    <option value="user">自己的模型</option>
                  </select>
                  {modelMode === "cloud" ? (
                    <>
                      <select value={cloudProviderId} onChange={(event) => setCloudProviderId(event.target.value)}>
                        <option value="">无云模型</option>
                        {cloudProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                      </select>
                      <select value={cloudModel} onChange={(event) => setCloudModel(event.target.value)}>
                        {selectedProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                      </select>
                    </>
                  ) : (
                    <select value={userModelId} onChange={(event) => setUserModelId(event.target.value)}>
                      <option value="">无自带模型</option>
                      {userModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                  )}
                  <button onClick={() => void publishSkill()} disabled={!selectedSkill}><Store size={16} />发布</button>
                </div>
              </header>
              <div className="chat-main">
                <div className="message-pane">
                  {messages.length === 0 && <div className="empty-chat"><img src={coverUrl} alt="" /><strong>还没有聊天</strong><span>选择模型，然后向这个 Skill 发送第一句话。</span></div>}
                  {messages.map((message) => (
                    <div key={message.id} className={`msg ${message.role}`}>
                      <div className="msg-bubble"><p>{message.content}</p>{message.modelLabel && <small>{message.modelLabel}</small>}</div>
                    </div>
                  ))}
                </div>
                <SkillInspector draft={draft} setDraft={setDraft} save={() => void saveSkill()} busy={busy} />
              </div>
              <form className="message-input" onSubmit={(event) => void sendMessage(event)}>
                <textarea value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="输入消息..." />
                <button disabled={busy || !composer.trim()}><Send size={18} /></button>
              </form>
            </section>
          )}

          {view === "import" && (
            <ToolPage title="导入聊天记录" subtitle="支持 TXT、CSV、JSON、HTML、MD。微信/QQ 请先用外部工具导出。">
              <div className="split-tools">
                <div className="panel">
                  <button className="primary-button" onClick={() => void openImportFile()}><Upload size={18} />选择导入文件</button>
                  <input value={importPreferredName} onChange={(event) => setImportPreferredName(event.target.value)} placeholder="蒸馏后的 Skill 名称（可选）" />
                  {importPreview && (
                    <>
                      <div className="stat-line">{importPreview.fileName} · {importPreview.messages.filter((m) => m.selected).length}/{importPreview.messages.length} 条已选择</div>
                      <button onClick={() => void distillImport()} disabled={busy}>蒸馏并添加 Skill</button>
                    </>
                  )}
                </div>
                <div className="panel preview-panel">
                  {importPreview?.messages.slice(0, 220).map((message) => (
                    <label key={message.id} className="import-row">
                      <input type="checkbox" checked={message.selected} onChange={() => setImportPreview((current) => current ? { ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, selected: !item.selected } : item) } : current)} />
                      <strong>{message.speaker}</strong>
                      <span>{message.content}</span>
                    </label>
                  )) ?? <div className="quiet-empty">选择文件后会在这里预览。</div>}
                </div>
              </div>
            </ToolPage>
          )}

          {view === "market" && (
            <ToolPage title="聊天广场" subtitle="匿名评论、点赞点踩、收藏和导入别人的 Skill。">
              <div className="market-tools">
                <div className="market-list">
                  <div className="search-box"><Search size={16} /><input value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} placeholder="搜索广场 Skill" /><button onClick={() => void refreshMarketplace()}>搜索</button></div>
                  {marketItems.map((item) => (
                    <article key={item.id} className={item.id === selectedMarketId ? "market-card active" : "market-card"} onClick={() => void selectMarket(item.id)}>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <div className="market-actions">
                        <button onClick={(event) => { event.stopPropagation(); void api.reactSkill(item.id, "up").then(refreshMarketplace); }}><ThumbsUp size={14} />{item.upvotes}</button>
                        <button onClick={(event) => { event.stopPropagation(); void api.reactSkill(item.id, "down").then(refreshMarketplace); }}><ThumbsDown size={14} />{item.downvotes}</button>
                        <button onClick={(event) => { event.stopPropagation(); void api.favorite(item.id).then(refreshMarketplace); }}><Star size={14} />{item.favorites}</button>
                        <button onClick={(event) => { event.stopPropagation(); void importMarketSkill(item.id); }}><Download size={14} />导入</button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="panel">
                  {selectedMarket ? (
                    <>
                      <h3>{selectedMarket.name}</h3>
                      <textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="匿名评论..." />
                      <button onClick={() => void addComment()}>发表评论</button>
                      {comments.map((comment) => <div key={comment.id} className="comment"><strong>{comment.displayName}</strong><p>{comment.content}</p></div>)}
                    </>
                  ) : <div className="quiet-empty">选择一个 Skill 查看匿名评论。</div>}
                </div>
              </div>
            </ToolPage>
          )}

          {view === "models" && (
            <ToolPage title="模型设置" subtitle="自己的模型 API Key 只保存在本机，平台云模型由管理员后台配置。">
              <div className="split-tools">
                <ModelForm form={userModelForm} setForm={setUserModelForm} onSave={() => void saveUserModel()} />
                <div className="panel">
                  <h3>已保存模型</h3>
                  {userModels.map((model) => <button key={model.id} className="row-button" onClick={() => setUserModelId(model.id)}><Cpu size={16} />{model.name}<small>{model.defaultModel}</small></button>)}
                </div>
              </div>
            </ToolPage>
          )}

          {view === "admin" && isAdmin && (
            <ToolPage title="管理员后台" subtitle="管理平台云模型供应商、价格和启停状态。">
              <div className="split-tools">
                <AdminProviderForm form={providerForm} setForm={setProviderForm} onSave={() => void saveAdminProvider()} />
                <div className="panel">
                  <button onClick={() => void api.adminProviders().then(setAdminProviders)}><RefreshCw size={16} />刷新供应商</button>
                  {adminProviders.map((provider) => <button key={provider.id} className="row-button" onClick={() => setProviderForm({ ...providerForm, id: provider.id, kind: provider.kind, name: provider.name, baseUrl: provider.baseUrl, modelId: provider.models[0]?.id ?? "", modelLabel: provider.models[0]?.label ?? "", contextWindow: provider.contextWindow, promptTokenPrice: provider.promptTokenPrice, completionTokenPrice: provider.completionTokenPrice, enabled: provider.enabled, apiKey: "" })}><ShieldCheck size={16} />{provider.name}<small>{provider.enabled ? "启用" : "停用"}</small></button>)}
                </div>
              </div>
            </ToolPage>
          )}

          {view === "settings" && (
            <ToolPage title="用户设置" subtitle="设置语言、主题、背景和透明度，这些参数会保存到数据库。">
              <div className="settings-grid">
                <SettingCard icon={<Globe />} title="语言">
                  <select value={auth.settings.language} onChange={(event) => void saveSettings({ language: event.target.value as "zh" | "en" })}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </SettingCard>
                <SettingCard icon={auth.settings.theme === "light" ? <Sun /> : <Moon />} title="主题">
                  <select value={auth.settings.theme} onChange={(event) => void saveSettings({ theme: event.target.value as UserSettings["theme"] })}>
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </SettingCard>
                <SettingCard icon={<ImageIcon />} title="背景">
                  <input value={auth.settings.backgroundUrl ?? ""} onChange={(event) => setAuth({ ...auth, settings: { ...auth.settings, backgroundUrl: event.target.value } })} placeholder="背景图片地址，留空使用默认封面" />
                  <button onClick={() => void saveSettings({ backgroundUrl: auth.settings.backgroundUrl || null })}>保存背景</button>
                </SettingCard>
                <SettingCard icon={<SlidersHorizontal />} title="透明度">
                  <label>背景遮罩 {auth.settings.backgroundOpacity.toFixed(2)}<input type="range" min="0" max="0.85" step="0.01" value={auth.settings.backgroundOpacity} onChange={(event) => void saveSettings({ backgroundOpacity: Number(event.target.value) })} /></label>
                  <label>窗口透明度 {auth.settings.windowOpacity.toFixed(2)}<input type="range" min="0.7" max="1" step="0.01" value={auth.settings.windowOpacity} onChange={(event) => void saveSettings({ windowOpacity: Number(event.target.value) })} /></label>
                </SettingCard>
              </div>
            </ToolPage>
          )}
        </main>
      </div>
    </div>
  );
}

function WindowButtons({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? "window-buttons compact" : "window-buttons"}>
      <button onClick={() => void window.chaq.window.minimize()}><Minimize2 size={14} /></button>
      {!compact && <button onClick={() => void window.chaq.window.maximize()}><Square size={13} /></button>}
      <button onClick={() => void window.chaq.window.close()}><X size={15} /></button>
    </div>
  );
}

function TitleBar({ user, onLogout }: { user: LoginUser; onLogout: () => void }): JSX.Element {
  return (
    <header className="title-bar">
      <div className="drag-title"><span className="qq-dot">Chaq</span><strong>{user.displayName}</strong><em>{roleLabel(user.role)}</em></div>
      <div className="title-actions"><button onClick={onLogout}><LogOut size={15} />退出</button><WindowButtons /></div>
    </header>
  );
}

function RailButton(props: { active: boolean; title: string; icon: JSX.Element; onClick: () => void }): JSX.Element {
  return <button className={props.active ? "rail-button active" : "rail-button"} title={props.title} onClick={props.onClick}>{React.cloneElement(props.icon, { size: 22 })}</button>;
}

function ToolPage(props: { title: string; subtitle: string; children: React.ReactNode }): JSX.Element {
  return <section className="tool-page"><header><h2>{props.title}</h2><p>{props.subtitle}</p></header>{props.children}</section>;
}

function SkillInspector({ draft, setDraft, save, busy }: { draft: SkillDraft; setDraft: (draft: SkillDraft) => void; save: () => void; busy: boolean }): JSX.Element {
  const update = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => setDraft({ ...draft, [key]: value });
  return (
    <aside className="skill-inspector">
      <img className="cover-thumb" src={draft.avatarUrl || coverUrl} alt="" />
      <label>名称<input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>简介<input value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      <label>人格<textarea value={draft.persona} onChange={(event) => update("persona", event.target.value)} /></label>
      <label>语气<textarea value={draft.tone} onChange={(event) => update("tone", event.target.value)} /></label>
      <label>边界<textarea value={draft.boundaries} onChange={(event) => update("boundaries", event.target.value)} /></label>
      <label>标签<input value={draft.tags.join(", ")} onChange={(event) => update("tags", splitTags(event.target.value))} /></label>
      <button onClick={save} disabled={busy}><Save size={16} />保存 Skill</button>
    </aside>
  );
}

function ModelForm({ form, setForm, onSave }: { form: any; setForm: (form: any) => void; onSave: () => void }): JSX.Element {
  return (
    <div className="panel form-panel">
      <h3>添加自己的模型</h3>
      <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{providerKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="名称" />
      <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="Base URL" />
      <input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} placeholder="模型名" />
      <input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="API Key" />
      <button onClick={onSave}><Save size={16} />保存</button>
    </div>
  );
}

function AdminProviderForm({ form, setForm, onSave }: { form: any; setForm: (form: any) => void; onSave: () => void }): JSX.Element {
  return (
    <div className="panel form-panel">
      <h3>平台云模型</h3>
      <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{providerKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="供应商名称" />
      <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="Base URL" />
      <input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="API Key" />
      <input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} placeholder="模型 ID" />
      <input value={form.modelLabel} onChange={(event) => setForm({ ...form, modelLabel: event.target.value })} placeholder="模型显示名" />
      <button onClick={onSave}><Save size={16} />保存供应商</button>
    </div>
  );
}

function SettingCard({ icon, title, children }: { icon: JSX.Element; title: string; children: React.ReactNode }): JSX.Element {
  return <div className="setting-card"><div className="setting-title">{React.cloneElement(icon, { size: 19 })}<strong>{title}</strong></div>{children}</div>;
}

function roleLabel(role: string): string {
  return role === "ADMIN" ? "管理员" : role === "CREATOR" ? "创作者" : "用户";
}

function skillToDraft(skill: SkillSummary): SkillDraft {
  return {
    name: skill.name,
    avatarUrl: skill.avatarUrl || coverUrl,
    description: skill.description,
    persona: skill.persona,
    tone: skill.tone,
    knowledge: skill.knowledge,
    boundaries: skill.boundaries,
    examples: skill.examples,
    tags: skill.tags
  };
}

function splitTags(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadRememberedAccounts(): RememberedAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("chaq.rememberedAccounts") || "[]") as RememberedAccount[];
    return parsed.filter((account) => account.sessionToken && account.user?.id);
  } catch {
    return [];
  }
}

function saveRememberedAccounts(accounts: RememberedAccount[]): void {
  localStorage.setItem("chaq.rememberedAccounts", JSON.stringify(accounts.slice(0, 6)));
}

function upsertRememberedAccount(accounts: RememberedAccount[], account: RememberedAccount): RememberedAccount[] {
  return [account, ...accounts.filter((item) => item.user.id !== account.user.id)].slice(0, 6);
}

createRoot(document.getElementById("root")!).render(<App />);
