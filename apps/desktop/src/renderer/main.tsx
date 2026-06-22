import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Bell,
  BellOff,
  Check,
  Clipboard,
  Clock,
  Cpu,
  Download,
  Edit3,
  Flag,
  Folder,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  Minimize2,
  Moon,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Share2,
  SlidersHorizontal,
  Square,
  Star,
  Store,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  User,
  Volume2,
  X
} from "lucide-react";
import type {
  ChatMessage,
  ImportPreview,
  MarketplaceComment,
  MarketplaceSkill,
  ModelProviderPublic,
  ProviderKind,
  SkillAutoMessageSettings,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  TokenTransaction,
  UserModelConfigPublic
} from "@chaq/shared";
import { api, type LoginUser, type UserSettings } from "./lib/api";
import { heuristicDraftFromMessages, parseImport } from "./lib/importParser";
import { MagneticButton, ShinyText, SpotlightCard } from "./components/react-bits";
import { AgentWorkspace } from "./components/agent-workspace";
import coverUrl from "./assets/chaq-cover.png";
import loginBgUrl from "./assets/chaq-login-bg.png";
import "./styles.css";

type View = "agents" | "chat" | "skill-editor" | "import" | "market" | "models" | "admin" | "settings";
type ModelMode = "cloud" | "user";
type SkillEditorTab = "profile" | "edit" | "share" | "more";
type SettingsCategory = "general" | "appearance" | "messages" | "storage" | "display";
type SkillKind = "friend" | "expert" | "partner" | "custom";
type LoginMode = "login" | "register";
type WindowAnchorRect = { x: number; y: number; width: number; height: number };
type UserModelFormState = {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};
type UserModelTestStatus = {
  state: "idle" | "testing" | "ok" | "error";
  message: string;
};
type ProfileFormState = {
  displayName: string;
  avatarUrl: string;
  email: string;
  emailCode: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

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
const userModelPresets: Record<ProviderKind, Omit<UserModelFormState, "id" | "apiKey">> = {
  openai: { kind: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  anthropic: { kind: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-haiku-latest" },
  google: { kind: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-1.5-flash" },
  deepseek: { kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  dashscope: { kind: "dashscope", name: "阿里 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  zhipu: { kind: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
  ollama: { kind: "ollama", name: "Ollama 本地模型", baseUrl: "http://127.0.0.1:11434", defaultModel: "llama3.1" },
  custom: { kind: "custom", name: "自定义 OpenAI Compatible", baseUrl: "", defaultModel: "" }
};
const urlParams = new URLSearchParams(window.location.search);
const isSettingsWindowMode = urlParams.get("settingsWindow") === "1";
const isProfileWindowMode = urlParams.get("profileWindow") === "1";
const isProfileEditWindowMode = urlParams.get("profileEditWindow") === "1";

function defaultAutoSettings(skillId = ""): SkillAutoMessageSettings {
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

function App(): JSX.Element {
  const [auth, setAuth] = useState<{ user: LoginUser; settings: UserSettings } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<UserSettings | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginMode, setLoginMode] = useState<LoginMode>("login");
  const [registerForm, setRegisterForm] = useState({ email: "", code: "", password: "", confirmPassword: "" });
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    displayName: "",
    avatarUrl: "",
    email: "",
    emailCode: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedAccount[]>([]);
  const [selectedRememberedId, setSelectedRememberedId] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [booting, setBooting] = useState(true);
  const [settingsSection, setSettingsSection] = useState<SettingsCategory>("general");

  const [view, setView] = useState<View>("agents");
  const [skillEditorTab, setSkillEditorTab] = useState<SkillEditorTab>("profile");
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>(() => loadPinnedSkillIds());
  const [newSkillKind, setNewSkillKind] = useState<SkillKind>("friend");
  const [newSkillSourceFile, setNewSkillSourceFile] = useState("");
  const [newSkillExpertField, setNewSkillExpertField] = useState("");
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
  const [autoSettings, setAutoSettings] = useState<SkillAutoMessageSettings>(defaultAutoSettings());
  const [tokenTransactions, setTokenTransactions] = useState<TokenTransaction[]>([]);
  const [skillSearch, setSkillSearch] = useState("");

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreferredName, setImportPreferredName] = useState("");

  const [marketItems, setMarketItems] = useState<MarketplaceSkill[]>([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [comments, setComments] = useState<MarketplaceComment[]>([]);
  const [commentText, setCommentText] = useState("");

  const [userModelForm, setUserModelForm] = useState<UserModelFormState>({
    id: "",
    kind: "openai" as ProviderKind,
    name: userModelPresets.openai.name,
    baseUrl: userModelPresets.openai.baseUrl,
    apiKey: "",
    defaultModel: userModelPresets.openai.defaultModel
  });
  const [userModelStatus, setUserModelStatus] = useState<UserModelTestStatus>({ state: "idle", message: "" });
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
  const activeSettings = settingsDraft ?? auth?.settings ?? null;
  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    const list = q ? skills.filter((skill) => `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase().includes(q)) : skills;
    return [...list].sort((a, b) => Number(pinnedSkillIds.includes(b.id)) - Number(pinnedSkillIds.includes(a.id)));
  }, [skillSearch, skills, pinnedSkillIds]);
  const isAdmin = auth?.user.role === "ADMIN";

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    if (auth) {
      setSettingsDraft(auth.settings);
      applySettings(auth.settings);
      setProfileForm((current) => ({
        ...current,
        displayName: auth.user.displayName,
        avatarUrl: auth.user.avatarUrl ?? "",
        email: auth.user.email ?? auth.user.username
      }));
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
      void loadAutoSettings(selectedSkill.id);
    } else {
      setDraft(blankSkill);
      setMessages([]);
      setAutoSettings(defaultAutoSettings());
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
    if (isSettingsWindowMode || isProfileWindowMode || isProfileEditWindowMode) {
      const token = urlParams.get("token");
      if (token) {
        sessionStorage.setItem("chaq.sessionToken", token);
      }
      try {
        const [user, settings] = await Promise.all([api.me(), api.settings()]);
        setAuth({ user, settings });
      } catch (error) {
        setLoginError(messageOf(error));
      } finally {
        setBooting(false);
      }
      return;
    }

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
      await refreshAll(user.id);
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
    if (loginMode === "register") {
      await register(event);
      return;
    }
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
      await refreshAll(result.user.id);
    } catch (error) {
      setLoginError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendRegisterCode(): Promise<void> {
    setLoginError("");
    setBusy(true);
    try {
      await api.requestRegisterCode({ email: registerForm.email });
      setLoginError("验证码已发送，请查看邮箱。");
    } catch (error) {
      setLoginError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function register(_event?: FormEvent): Promise<void> {
    setLoginError("");
    setBusy(true);
    try {
      const result = await api.register(registerForm);
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
      await refreshAll(result.user.id);
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
    setLoginMode("login");
    await window.chaq.window.setMode("login");
  }

  async function refreshAll(userId = auth?.user.id): Promise<void> {
    await Promise.allSettled([refreshLocal(), refreshRemote(), refreshMarketplace(), refreshUserModels(userId)]);
  }

  async function refreshLocal(): Promise<void> {
    const list = await window.chaq.skills.list();
    setSkills(list);
  }

  async function refreshRemote(): Promise<void> {
    try {
      const [user, settings, providers] = await Promise.all([api.me(), api.settings(), api.providers()]);
      setAuth({ user, settings });
      setCloudProviders(providers);
      if (user.role === "ADMIN") {
        setAdminProviders(await api.adminProviders().catch(() => []));
      }
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

  async function refreshUserModels(userId = auth?.user.id): Promise<void> {
    if (!userId) {
      setUserModels([]);
      setUserModelId("");
      return;
    }
    const models = await window.chaq.models.listUser(userId);
    setUserModels(models);
    if (!models.some((model) => model.id === userModelId)) setUserModelId(models[0]?.id ?? "");
  }

  async function loadMessages(skillId: string): Promise<void> {
    setMessages(await window.chaq.messages.list(skillId));
  }

  async function loadAutoSettings(skillId: string): Promise<void> {
    setAutoSettings(await window.chaq.skills.getAutoSettings(skillId));
  }

  function openSkillEditor(tab: SkillEditorTab, skill?: SkillSummary | null): void {
    if (skill) {
      setSelectedSkillId(skill.id);
      setDraft(skillToDraft(skill));
      void loadAutoSettings(skill.id);
    } else if (tab === "profile") {
      setSelectedSkillId(null);
      setDraft({ ...blankSkill, name: `Skill ${skills.length + 1}` });
      setAutoSettings(defaultAutoSettings());
      setNewSkillKind("friend");
      setNewSkillSourceFile("");
      setNewSkillExpertField("");
    }
    setSkillEditorTab(tab);
    setView("skill-editor");
    if (tab === "more") {
      void refreshTokenLedger();
    }
  }

  async function addSkill(): Promise<void> {
    openSkillEditor("profile", null);
  }

  async function saveSkill(sourceKind: SkillSourceKind = "manual"): Promise<void> {
    setBusy(true);
    try {
      const normalizedName = draft.name.trim().toLowerCase();
      const duplicate = skills.some((skill) => skill.id !== selectedSkill?.id && skill.name.trim().toLowerCase() === normalizedName);
      if (duplicate) {
        throw new Error("本地已经存在同名 Skill，请换一个昵称或备注。");
      }
      const saved = selectedSkill
        ? await window.chaq.skills.update(selectedSkill.id, draft, sourceKind)
        : await createSyncedSkill(draft, sourceKind);
      await refreshLocal();
      setSelectedSkillId(saved.id);
      setNotice("Skill 已保存");
      setView("chat");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSyncedSkill(skill: SkillDraft, sourceKind: SkillSourceKind = "manual"): Promise<SkillSummary> {
    const remote = await api.createSkill(skill, sourceKind);
    return window.chaq.skills.create(skill, sourceKind, remote.id);
  }

  async function saveAutoSettings(next: Partial<SkillAutoMessageSettings>): Promise<void> {
    if (!selectedSkill) return;
    const saved = await window.chaq.skills.saveAutoSettings({
      ...autoSettings,
      ...next,
      skillId: selectedSkill.id
    });
    setAutoSettings(saved);
  }

  async function refreshTokenLedger(): Promise<void> {
    setTokenTransactions(await api.tokenLedger().catch(() => []));
  }

  async function copySkillShareCode(): Promise<void> {
    if (!selectedSkill) return;
    await navigator.clipboard.writeText(`chaq://skill/${selectedSkill.id}`);
    setNotice("Skill 分享代码已复制");
  }

  async function chooseStoragePath(key: "localChatDataPath" | "fileStoragePath"): Promise<void> {
    const folder = await window.chaq.files.openFolder();
    if (!folder) return;
    await saveSettings({ [key]: folder });
  }

  async function chooseNewSkillImportFile(): Promise<void> {
    const file = await window.chaq.imports.openFile();
    if (!file) return;
    setNewSkillSourceFile(file.fileName);
    setDraft((current) => ({
      ...current,
      knowledge: [current.knowledge, `导入材料：${file.fileName}`].filter(Boolean).join("\n")
    }));
  }

  async function chooseNewSkillAvatar(): Promise<void> {
    const image = await window.chaq.files.openImage();
    if (!image) return;
    setDraft((current) => ({ ...current, avatarUrl: image.dataUrl }));
    setNotice(`${image.fileName} 已设置为头像，保存后会同步。`);
  }

  async function chooseProfileAvatar(): Promise<void> {
    const image = await window.chaq.files.openImage();
    if (!image) return;
    setProfileForm((current) => ({ ...current, avatarUrl: image.dataUrl }));
    setNotice(`${image.fileName} 已设置为头像，保存后会同步。`);
  }

  async function openSettingsWindow(): Promise<void> {
    const token = sessionStorage.getItem("chaq.sessionToken") || localStorage.getItem("chaq.sessionToken");
    try {
      await window.chaq.window.openSettings(token);
    } catch {
      setView("settings");
    }
  }

  async function openProfileWindow(anchor?: WindowAnchorRect): Promise<void> {
    const token = sessionStorage.getItem("chaq.sessionToken") || localStorage.getItem("chaq.sessionToken");
    await window.chaq.window.openProfile(token, anchor);
  }

  async function openProfileEditWindow(): Promise<void> {
    const token = sessionStorage.getItem("chaq.sessionToken") || localStorage.getItem("chaq.sessionToken");
    await window.chaq.window.openProfileEdit(token);
  }

  function togglePinnedSkill(): void {
    if (!selectedSkill) return;
    const next = pinnedSkillIds.includes(selectedSkill.id)
      ? pinnedSkillIds.filter((id) => id !== selectedSkill.id)
      : [selectedSkill.id, ...pinnedSkillIds];
    setPinnedSkillIds(next);
    localStorage.setItem("chaq.pinnedSkills", JSON.stringify(next));
  }

  async function deleteCurrentSkill(): Promise<void> {
    if (!selectedSkill || !confirm(`删除 Skill「${selectedSkill.name}」？`)) return;
    await window.chaq.skills.delete(selectedSkill.id);
    setChatDrawerOpen(false);
    setSelectedSkillId(null);
    setMessages([]);
    await refreshLocal();
  }

  async function clearCurrentMessages(): Promise<void> {
    if (!selectedSkill || !confirm(`删除「${selectedSkill.name}」的本地聊天记录？`)) return;
    await window.chaq.messages.clear(selectedSkill.id);
    setMessages([]);
    setChatDrawerOpen(false);
  }

  async function reportCurrentSkill(): Promise<void> {
    if (!selectedSkill) return;
    try {
      await api.reportSkill(selectedSkill.id, "user_report");
      setNotice("举报已提交");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setChatDrawerOpen(false);
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
          userId: auth?.user.id,
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
      const created = await createSyncedSkill(nextDraft, importPreview.sourceKind);
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
    const created = await createSyncedSkill(response.skill, "manual");
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

  function applyUserModelPreset(kind: ProviderKind): void {
    const preset = userModelPresets[kind];
    setUserModelForm((current) => ({
      ...current,
      id: "",
      kind,
      name: preset.name,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel
    }));
    setUserModelStatus({ state: "idle", message: `${preset.name} 的默认接口地址已填好，只需要填写 API Key。` });
  }

  async function testUserModel(): Promise<void> {
    setUserModelStatus({ state: "testing", message: "正在检测 API 连接..." });
    try {
      const result = await window.chaq.models.testUser({
        kind: userModelForm.kind,
        name: userModelForm.name,
        baseUrl: userModelForm.baseUrl,
        apiKey: userModelForm.apiKey,
        defaultModel: userModelForm.defaultModel
      });
      if (!result.ok) {
        setUserModelStatus({ state: "error", message: result.message });
        return;
      }
      setUserModelForm((current) => ({
        ...current,
        kind: result.kind,
        name: result.name || current.name,
        baseUrl: result.baseUrl || current.baseUrl,
        defaultModel: result.suggestedModel || result.defaultModel || current.defaultModel
      }));
      setUserModelStatus({ state: "ok", message: result.message });
    } catch (error) {
      setUserModelStatus({ state: "error", message: messageOf(error) });
    }
  }

  async function detectUserModelProvider(): Promise<void> {
    if (!userModelForm.apiKey.trim()) {
      setUserModelStatus({ state: "error", message: "请先填写 API Key，再自动识别厂商。" });
      return;
    }
    setUserModelStatus({ state: "testing", message: "正在尝试识别 API Key 所属厂商..." });
    try {
      const result = await window.chaq.models.detectUserProvider(userModelForm.apiKey);
      if (!result.ok) {
        setUserModelStatus({ state: "error", message: result.message });
        return;
      }
      setUserModelForm((current) => ({
        ...current,
        id: "",
        kind: result.kind,
        name: result.name,
        baseUrl: result.baseUrl,
        defaultModel: result.suggestedModel || result.defaultModel,
        apiKey: current.apiKey
      }));
      setUserModelStatus({ state: "ok", message: `识别为 ${result.name}。${result.message}` });
    } catch (error) {
      setUserModelStatus({ state: "error", message: messageOf(error) });
    }
  }

  function editUserModel(model: UserModelConfigPublic): void {
    setUserModelForm({
      id: model.id,
      kind: model.kind,
      name: model.name,
      baseUrl: model.baseUrl,
      apiKey: "",
      defaultModel: model.defaultModel
    });
    setUserModelStatus({ state: "idle", message: "正在编辑已保存模型。出于安全考虑，请重新输入 API Key 后保存。" });
  }

  async function deleteUserModel(model: UserModelConfigPublic): Promise<void> {
    if (!auth || !confirm(`删除模型「${model.name}」？`)) return;
    await window.chaq.models.deleteUser(model.id, auth.user.id);
    if (userModelId === model.id) setUserModelId("");
    if (userModelForm.id === model.id) {
      setUserModelForm({ id: "", apiKey: "", ...userModelPresets.openai });
    }
    await refreshUserModels(auth.user.id);
    setNotice("已删除自己的模型配置");
  }

  async function saveUserModel(): Promise<void> {
    if (!auth) return;
    try {
      if (!userModelForm.name.trim()) throw new Error("请输入模型名称。");
      if (!userModelForm.baseUrl.trim()) throw new Error("请输入 Base URL。");
      if (!userModelForm.defaultModel.trim()) throw new Error("请输入模型名称/ID。");
      if (userModelForm.kind !== "ollama" && !userModelForm.apiKey.trim()) throw new Error("请输入 API Key。");
      const saved = await window.chaq.models.saveUser({
        ...userModelForm,
        userId: auth.user.id,
        id: userModelForm.id || undefined,
        name: userModelForm.name.trim(),
        baseUrl: userModelForm.baseUrl.trim(),
        apiKey: userModelForm.apiKey.trim(),
        defaultModel: userModelForm.defaultModel.trim()
      });
      setUserModelId(saved.id);
      await refreshUserModels(auth.user.id);
      setUserModelForm((current) => ({ ...current, id: saved.id, apiKey: "" }));
      setUserModelStatus({ state: "ok", message: "已保存。API Key 已加密保存，本页不会回显密钥。" });
      setNotice("已保存自己的模型 API");
    } catch (error) {
      setNotice(`保存模型失败：${messageOf(error)}`);
    }
  }

  async function saveAdminProvider(): Promise<void> {
    try {
      await api.saveProvider({
        id: providerForm.id || undefined,
        kind: providerForm.kind,
        name: providerForm.name.trim(),
        baseUrl: providerForm.baseUrl.trim(),
        apiKey: providerForm.apiKey.trim(),
        models: [{ id: providerForm.modelId.trim(), label: providerForm.modelLabel.trim(), contextWindow: Number(providerForm.contextWindow) }],
        enabled: providerForm.enabled,
        promptTokenPrice: Number(providerForm.promptTokenPrice),
        completionTokenPrice: Number(providerForm.completionTokenPrice),
        contextWindow: Number(providerForm.contextWindow)
      });
      setAdminProviders(await api.adminProviders());
      setProviderForm((current) => ({ ...current, apiKey: "" }));
      await refreshRemote();
      setNotice("已保存平台云模型");
    } catch (error) {
      setNotice(`保存云模型失败：${messageOf(error)}`);
    }
  }

  async function saveSettings(next: Partial<UserSettings>): Promise<void> {
    previewSettings(next);
    const saved = await api.saveSettings(next);
    setAuth((current) => current ? { ...current, settings: saved } : current);
    setSettingsDraft(saved);
    applySettings(saved);
  }

  async function sendProfileEmailCode(): Promise<void> {
    setNotice("");
    setBusy(true);
    try {
      await api.requestProfileEmailCode({ email: profileForm.email });
      setNotice("验证码已发送，请查看邮箱。");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(): Promise<void> {
    setNotice("");
    setBusy(true);
    try {
      const payload: Parameters<typeof api.saveMe>[0] = {
        displayName: profileForm.displayName.trim(),
        avatarUrl: profileForm.avatarUrl.trim() || null
      };
      if (profileForm.email.trim() && profileForm.email.trim() !== (auth?.user.email ?? auth?.user.username)) {
        payload.email = profileForm.email.trim();
        payload.emailCode = profileForm.emailCode.trim();
      }
      if (profileForm.currentPassword || profileForm.newPassword || profileForm.confirmPassword) {
        payload.currentPassword = profileForm.currentPassword;
        payload.newPassword = profileForm.newPassword;
        payload.confirmPassword = profileForm.confirmPassword;
      }
      const user = await api.saveMe(payload);
      setAuth((current) => current ? { ...current, user } : current);
      setProfileForm((current) => ({
        ...current,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        emailCode: ""
      }));
      setNotice("资料已保存。");
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  function previewSettings(next: Partial<UserSettings>): void {
    setSettingsDraft((current) => {
      const base = current ?? auth?.settings;
      if (!base) return current;
      const updated = { ...base, ...next };
      applySettings(updated);
      return updated;
    });
  }

  async function chooseBackgroundImage(): Promise<void> {
    const image = await window.chaq.files.openBackgroundImage();
    if (!image) return;
    await saveSettings({ backgroundUrl: image.dataUrl });
  }

  function openSettingsSection(section: SettingsCategory): void {
    setSettingsSection(section);
  }

  function applySettings(settings: UserSettings): void {
    document.documentElement.lang = settings.language === "en" ? "en" : "zh-CN";
    document.documentElement.dataset.locale = settings.language;
    document.documentElement.dataset.theme = settings.theme === "system" ? "dark" : settings.theme;
    document.documentElement.style.setProperty("--window-opacity", String(settings.backgroundOpacity));
    void window.chaq.window.setOpacity(settings.windowOpacity);
  }

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="login-cover" style={{ backgroundImage: `url(${loginBgUrl})` }} />
        <LoginBackgroundCanvas />
        <div className="boot-brand">
          <div className="app-logo">C</div>
          <strong>Chaq</strong>
        </div>
      </div>
    );
  }

  if (isSettingsWindowMode && activeSettings) {
    return (
      <div className="settings-window-shell" onPointerDown={startWindowDrag}>
        <WindowButtons compact />
        <ToolPage title={activeSettings.language === "en" ? "Settings" : "用户设置"} subtitle={activeSettings.language === "en" ? "Preferences, notifications, storage and appearance." : "管理 Chaq 的偏好、提示、存储和外观。"}>
          <SettingsPanel
            activeSettings={activeSettings}
            settingsSection={settingsSection}
            openSettingsSection={openSettingsSection}
            saveSettings={(next) => void saveSettings(next)}
            previewSettings={previewSettings}
            chooseBackgroundImage={() => void chooseBackgroundImage()}
            chooseStoragePath={(key) => void chooseStoragePath(key)}
          />
        </ToolPage>
      </div>
    );
  }

  if (isProfileWindowMode && auth) {
    return (
      <div className="profile-window-shell" onPointerDown={startWindowDrag}>
        <WindowButtons compact />
        <ProfileCard user={auth.user} onEdit={() => void openProfileEditWindow()} />
      </div>
    );
  }

  if (isProfileEditWindowMode && auth) {
    return (
      <div className="profile-edit-window-shell" onPointerDown={startWindowDrag}>
        <WindowButtons compact />
        <ProfileEditPanel
          user={auth.user}
          form={profileForm}
          setForm={setProfileForm}
          notice={notice}
          busy={busy}
          onSendEmailCode={() => void sendProfileEmailCode()}
          onChooseAvatar={() => void chooseProfileAvatar()}
          onSave={() => void saveProfile()}
        />
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="login-window">
        <div className="login-cover" style={{ backgroundImage: `url(${loginBgUrl})` }} />
        <LoginBackgroundCanvas />
        <WindowButtons compact />
        <div className="login-top-brand">
          <div className="app-logo small">C</div>
          <strong><ShinyText>Chaq</ShinyText></strong>
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
                  setLoginMode("login");
                  setLoginError("");
                }}
                title={account.user.displayName}
              >
                <img src={account.user.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
              </button>
            ))}
            {rememberedAccounts.length === 0 && <div className="remembered-placeholder"><User size={42} /></div>}
          </div>
          <strong>{loginMode === "register" ? "注册 Chaq" : selectedRemembered && !showAccountForm ? selectedRemembered.user.displayName : "登录 Chaq"}</strong>
          {selectedRemembered && !showAccountForm && <small>{roleLabel(selectedRemembered.user.role)}</small>}
        </div>
        <SpotlightCard
          as="form"
          spotlightColor="rgba(82, 211, 178, 0.2)"
          className={loginMode === "register" ? "login-card account-mode register-mode" : showAccountForm || !selectedRemembered ? "login-card account-mode" : "login-card remembered-mode"}
          onSubmit={(event) => void login(event)}
        >
          {loginMode === "register" ? (
            <>
              <label><User size={16} /><input value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} placeholder="邮箱" autoFocus /></label>
              <div className="login-code-row">
                <label><ShieldCheck size={16} /><input value={registerForm.code} onChange={(event) => setRegisterForm({ ...registerForm, code: event.target.value })} placeholder="邮箱验证码" /></label>
                <button type="button" onClick={() => void sendRegisterCode()} disabled={busy || !registerForm.email.trim()}>发送</button>
              </div>
              <label><Lock size={16} /><input type="password" value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} placeholder="密码，至少 8 位且包含字母和数字" /></label>
              <label><Lock size={16} /><input type="password" value={registerForm.confirmPassword} onChange={(event) => setRegisterForm({ ...registerForm, confirmPassword: event.target.value })} placeholder="再次输入密码" /></label>
              <label className="remember-check"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />记住我</label>
            </>
          ) : showAccountForm || !selectedRemembered ? (
            <>
              <label><User size={16} /><input value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} placeholder="邮箱 / 账号" autoFocus /></label>
              <label><Lock size={16} /><input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="密码" /></label>
              <label className="remember-check"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />记住我</label>
            </>
          ) : null}
          {loginError && <div className="login-error">{loginError}</div>}
          <button className="primary-button" disabled={busy}><ShinyText disabled={busy}>{busy ? "处理中..." : loginMode === "register" ? "注册并登录" : "登录"}</ShinyText></button>
          <div className="login-mode-actions">
            {!showAccountForm && selectedRemembered && loginMode === "login" ? (
              <button type="button" className="text-button" onClick={() => { setShowAccountForm(true); setLoginMode("login"); setLoginError(""); }}>切换账号</button>
            ) : null}
            {loginMode === "register" ? (
              <button type="button" className="text-button" onClick={() => { setLoginMode("login"); setLoginError(""); }}>已有账号登录</button>
            ) : (
              <button type="button" className="text-button" onClick={() => { setShowAccountForm(true); setLoginMode("register"); setLoginError(""); }}>注册账号</button>
            )}
          </div>
          <div className="login-hints"><span>Chaq Skill Messenger</span></div>
        </SpotlightCard>
      </div>
    );
  }

  return (
    <div
      className="qq-shell"
      style={{
        backgroundImage: `linear-gradient(rgba(18,18,24,var(--window-opacity)), rgba(18,18,24,var(--window-opacity))), url(${activeSettings?.backgroundUrl || coverUrl})`
      }}
    >
      <TitleBar user={auth.user} />
      <div className={view === "agents" ? "app-body agent-mode" : "app-body"}>
        <aside className="icon-rail">
          <button
            className="avatar profile-trigger"
            title="个人资料"
            onClick={(event) => void openProfileWindow(rectToAnchor(event.currentTarget.getBoundingClientRect()))}
          >
            <img src={auth.user.avatarUrl || coverUrl} alt="" onError={fallbackImage} /><span />
          </button>
          <RailButton active={view === "agents"} title="Agent OS" icon={<Bot />} onClick={() => setView("agents")} />
          <RailButton active={view === "chat"} title="Skill 聊天" icon={<MessageCircle />} onClick={() => setView("chat")} />
          <RailButton active={view === "import"} title="导入" icon={<Upload />} onClick={() => setView("import")} />
          <RailButton active={view === "market"} title="广场" icon={<Store />} onClick={() => setView("market")} />
          <RailButton active={view === "models"} title="模型" icon={<Cpu />} onClick={() => setView("models")} />
          {isAdmin && <RailButton active={view === "admin"} title="后台" icon={<ShieldCheck />} onClick={() => setView("admin")} />}
          <div className="rail-spacer" />
          <RailButton active={view === "settings"} title="设置" icon={<Settings />} onClick={() => void openSettingsWindow()} />
        </aside>

        {view !== "agents" && <aside className="skill-column">
          <div className="search-box"><Search size={16} /><input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="搜索 Skill" /></div>
          <button className="add-skill" onClick={() => void addSkill()}><Plus size={18} />添加 Skill</button>
          <div className="skill-list-qq">
            {filteredSkills.map((skill) => (
              <MagneticButton key={skill.id} className={skill.id === selectedSkillId ? "skill-card active" : "skill-card"} onClick={() => { setSelectedSkillId(skill.id); setView("chat"); }}>
                <img src={skill.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
                <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                <em>{formatSkillTime(skill.updatedAt)}</em>
              </MagneticButton>
            ))}
          </div>
        </aside>}

        <main className="content">
          {view === "agents" && (
            <AgentWorkspace user={auth.user} providers={cloudProviders} skills={skills} onNotice={setNotice} />
          )}
          {view === "chat" && (
            <section className="chat-view">
              <header className="chat-title">
                <div><h2>{selectedSkill ? draft.name : "选择 Skill"}</h2><p>{selectedSkill ? draft.description : "从左侧选择一个 Skill，或添加新的 Skill。"}</p></div>
                <div className="chat-actions">
                  <button title="编辑 Skill" disabled={!selectedSkill} onClick={() => openSkillEditor("edit", selectedSkill)}><Edit3 size={16} />编辑</button>
                  <button title="分享 Skill" disabled={!selectedSkill} onClick={() => openSkillEditor("share", selectedSkill)}><Share2 size={16} />分享</button>
                  <button className="icon-only-button" title="更多" disabled={!selectedSkill} onClick={() => setChatDrawerOpen((open) => !open)}><MoreHorizontal size={19} /></button>
                </div>
              </header>
              <div className="message-pane">
                {!selectedSkill && <div className="empty-chat"><img src={loginBgUrl} alt="" /><strong>还没有选择 Skill</strong><span>左侧列表会像 QQ 联系人一样展示你的 Skill。</span></div>}
                {selectedSkill && messages.length === 0 && <div className="empty-chat"><img src={selectedSkill.avatarUrl || coverUrl} alt="" onError={fallbackImage} /><strong>还没有聊天</strong><span>向这个 Skill 发送第一句话。</span></div>}
                {messages.map((message) => (
                  <div key={message.id} className={`msg ${message.role}`}>
                    <div className="msg-bubble"><p>{message.content}</p>{message.modelLabel && <small>{message.modelLabel}</small>}</div>
                  </div>
                ))}
              </div>
              <form className="message-input" onSubmit={(event) => void sendMessage(event)}>
                <textarea value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="输入消息..." />
                <button disabled={busy || !composer.trim() || !selectedSkill}><Send size={18} /></button>
              </form>
              {selectedSkill && (
                <aside className={chatDrawerOpen ? "chat-more-drawer open" : "chat-more-drawer"}>
                  <div className="drawer-group">
                    <label className="drawer-switch"><span><Pin size={16} />置顶</span><input type="checkbox" checked={pinnedSkillIds.includes(selectedSkill.id)} onChange={togglePinnedSkill} /></label>
                    <label className="drawer-switch"><span><BellOff size={16} />消息免打扰</span><input type="checkbox" checked={autoSettings.doNotDisturb} onChange={(event) => void saveAutoSettings({ doNotDisturb: event.target.checked })} /></label>
                  </div>
                  <div className="drawer-group">
                    <button onClick={() => void clearCurrentMessages()}><Trash2 size={16} />删除聊天记录</button>
                    <button onClick={() => void deleteCurrentSkill()}><Trash2 size={16} />删除 Skill</button>
                  </div>
                  <button className="drawer-report" onClick={() => void reportCurrentSkill()}><Flag size={15} />举报该 Skill</button>
                </aside>
              )}
            </section>
          )}

          {view === "skill-editor" && (
            <SkillEditorPage
              tab={skillEditorTab}
              setTab={setSkillEditorTab}
              skill={selectedSkill}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              onBack={() => setView("chat")}
              onSave={() => void saveSkill()}
              onPublish={() => void publishSkill()}
              onCopyShare={() => void copySkillShareCode()}
              modelMode={modelMode}
              setModelMode={setModelMode}
              cloudProviders={cloudProviders}
              cloudProviderId={cloudProviderId}
              setCloudProviderId={setCloudProviderId}
              selectedProvider={selectedProvider}
              cloudModel={cloudModel}
              setCloudModel={setCloudModel}
              userModels={userModels}
              userModelId={userModelId}
              setUserModelId={setUserModelId}
              autoSettings={autoSettings}
              saveAutoSettings={(next) => void saveAutoSettings(next)}
              tokenTransactions={tokenTransactions}
              newSkillKind={newSkillKind}
              setNewSkillKind={setNewSkillKind}
              newSkillSourceFile={newSkillSourceFile}
              chooseNewSkillImportFile={() => void chooseNewSkillImportFile()}
              chooseNewSkillAvatar={() => void chooseNewSkillAvatar()}
              newSkillExpertField={newSkillExpertField}
              setNewSkillExpertField={setNewSkillExpertField}
            />
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
            <ToolPage
              title="我的模型 API"
              subtitle="选择厂商后会自动填入接口地址；API Key 加密保存在当前账号的本机数据库中。"
            >
              <div className="split-tools">
                <ModelForm
                  form={userModelForm}
                  setForm={setUserModelForm}
                  onKindChange={applyUserModelPreset}
                  onDetect={() => void detectUserModelProvider()}
                  onTest={() => void testUserModel()}
                  onSave={() => void saveUserModel()}
                  status={userModelStatus}
                />
                <div className="panel saved-models-panel">
                  <div className="panel-title-row">
                    <h3>当前账号已保存模型</h3>
                    <button onClick={() => void refreshUserModels(auth?.user.id)}><RefreshCw size={16} />刷新</button>
                  </div>
                  {userModels.length === 0 && <div className="quiet-empty">还没有保存自己的模型。选择厂商、填写 API Key，检测成功后保存即可。</div>}
                  {userModels.map((model) => (
                    <div key={model.id} className={model.id === userModelId ? "saved-model-row active" : "saved-model-row"}>
                      <button className="row-button" onClick={() => { setUserModelId(model.id); editUserModel(model); }}>
                        <Cpu size={16} />{model.name}<small>{model.defaultModel}</small>
                      </button>
                      <button className="icon-only-button" title="删除模型" onClick={() => void deleteUserModel(model)}><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {isAdmin && <button className="text-button" onClick={() => setView("admin")}>管理员平台云模型配置在后台页面</button>}
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

          {view === "settings" && activeSettings && (
            <ToolPage title="用户设置" subtitle="管理 Chaq 的偏好、提示、存储和外观。">
              <div className="settings-layout">
                <nav className="settings-nav" aria-label="Settings sections">
                  <button type="button" className={settingsSection === "general" ? "active" : ""} onClick={() => openSettingsSection("general")}><Settings size={16} />通用</button>
                  <button type="button" className={settingsSection === "appearance" ? "active" : ""} onClick={() => openSettingsSection("appearance")}><ImageIcon size={16} />外观</button>
                  <button type="button" className={settingsSection === "messages" ? "active" : ""} onClick={() => openSettingsSection("messages")}><Bell size={16} />消息提示</button>
                  <button type="button" className={settingsSection === "storage" ? "active" : ""} onClick={() => openSettingsSection("storage")}><HardDrive size={16} />存储</button>
                  <button type="button" className={settingsSection === "display" ? "active" : ""} onClick={() => openSettingsSection("display")}><SlidersHorizontal size={16} />显示</button>
                </nav>
                <div className="settings-content">
                  {settingsSection === "general" && <section className="settings-section">
                    <header>
                      <h3>通用</h3>
                    </header>
                    <div className="settings-row">
                      <div>
                        <strong><Globe size={16} />语言</strong>
                        <span>选择界面显示语言。</span>
                      </div>
                      <select value={activeSettings.language} onChange={(event) => void saveSettings({ language: event.target.value as "zh" | "en" })}>
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>{activeSettings.theme === "light" ? <Sun size={16} /> : <Moon size={16} />}主题</strong>
                        <span>切换深色、浅色或系统主题。</span>
                      </div>
                      <select value={activeSettings.theme} onChange={(event) => void saveSettings({ theme: event.target.value as UserSettings["theme"] })}>
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                        <option value="system">跟随系统</option>
                      </select>
                    </div>
                  </section>}

                  {settingsSection === "appearance" && <section className="settings-section">
                    <header>
                      <h3>背景</h3>
                    </header>
                    <div className="background-setting">
                      <img src={activeSettings.backgroundUrl || coverUrl} alt="" />
                      <div className="background-actions">
                        <button onClick={() => void chooseBackgroundImage()}><ImageIcon size={16} />更改背景图</button>
                        <button className="text-button" onClick={() => void saveSettings({ backgroundUrl: null })}>恢复默认</button>
                      </div>
                    </div>
                  </section>}

                  {settingsSection === "messages" && <section className="settings-section">
                    <header>
                      <h3>消息提示</h3>
                    </header>
                    <div className="settings-row">
                      <div><strong><Volume2 size={16} />开启消息提示音</strong><span>收到 Skill 消息时播放提示音。</span></div>
                      <label className="switch-row"><input type="checkbox" checked={activeSettings.notificationSound ?? true} onChange={(event) => void saveSettings({ notificationSound: event.target.checked })} />开启</label>
                    </div>
                    <div className="settings-row">
                      <div><strong><BellOff size={16} />图标闪烁</strong><span>新消息到达时突出显示窗口图标。</span></div>
                      <label className="switch-row"><input type="checkbox" checked={activeSettings.iconFlash ?? true} onChange={(event) => void saveSettings({ iconFlash: event.target.checked })} />开启</label>
                    </div>
                  </section>}

                  {settingsSection === "storage" && <section className="settings-section">
                    <header>
                      <h3>存储</h3>
                    </header>
                    <div className="settings-row storage-row">
                      <div><strong><HardDrive size={16} />本地聊天数据存储位置</strong><span>{activeSettings.localChatDataPath || "E:\\Environment\\Chaq\\user-data"}</span></div>
                      <button onClick={() => void chooseStoragePath("localChatDataPath")}><Folder size={16} />更改</button>
                    </div>
                    <div className="settings-row storage-row">
                      <div><strong><Folder size={16} />文件存储位置</strong><span>{activeSettings.fileStoragePath || "E:\\Environment\\Chaq\\files"}</span></div>
                      <button onClick={() => void chooseStoragePath("fileStoragePath")}><Folder size={16} />更改</button>
                    </div>
                  </section>}

                  {settingsSection === "display" && <section className="settings-section">
                    <header>
                      <h3>透明度</h3>
                    </header>
                    <SettingRange
                      label="背景遮罩"
                      value={activeSettings.backgroundOpacity}
                      min={0}
                      max={0.85}
                      onChange={(value) => previewSettings({ backgroundOpacity: value })}
                      onCommit={(value) => void saveSettings({ backgroundOpacity: value })}
                    />
                    <SettingRange
                      label="窗口透明度"
                      value={activeSettings.windowOpacity}
                      min={0.7}
                      max={1}
                      onChange={(value) => previewSettings({ windowOpacity: value })}
                      onCommit={(value) => void saveSettings({ windowOpacity: value })}
                    />
                  </section>}
                </div>
              </div>
            </ToolPage>
          )}

        </main>
      </div>
    </div>
  );
}

function rectToAnchor(rect: DOMRect): WindowAnchorRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function startWindowDrag(event: React.PointerEvent<HTMLElement>): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest("button,input,select,textarea,label,a,[data-no-window-drag='true']")) return;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Some synthetic pointer events cannot be captured; dragging still works without it.
  }
  void window.chaq.window.beginDrag();

  const stop = () => {
    void window.chaq.window.endDrag();
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("blur", stop);
  };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("blur", stop);
}

function LoginBackgroundCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let lastPaint = 0;
    let targetX = 0;
    let targetY = 0;
    let cursorX = 0;
    let cursorY = 0;
    const glyphLayer = document.createElement("canvas");
    const glyphContext = glyphLayer.getContext("2d");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paintInterval = 1000 / 24;

    const hashValue = (value: number) => {
      const next = Math.sin(value * 12.9898) * 43758.5453;
      return next - Math.floor(next);
    };
    const glyphs = ["0", "1", "+", "·"];

    const buildGlyphLayer = (dpr: number) => {
      if (!glyphContext) return;
      glyphLayer.width = Math.floor(width * dpr);
      glyphLayer.height = Math.floor(height * dpr);
      glyphContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      glyphContext.clearRect(0, 0, width, height);

      const step = 26;
      glyphContext.lineWidth = 0.65;
      glyphContext.strokeStyle = "rgba(205, 218, 228, 0.035)";
      glyphContext.beginPath();
      for (let x = step; x < width; x += step) {
        glyphContext.moveTo(x + 0.5, 0);
        glyphContext.lineTo(x + 0.5, height);
      }
      for (let y = step; y < height; y += step) {
        glyphContext.moveTo(0, y + 0.5);
        glyphContext.lineTo(width, y + 0.5);
      }
      glyphContext.stroke();

      glyphContext.font = "10px Consolas, monospace";
      glyphContext.textAlign = "center";
      glyphContext.textBaseline = "middle";
      let index = 0;
      for (let y = step; y < height; y += step) {
        for (let x = step; x < width; x += step) {
          const seed = hashValue(index + x * 0.13 + y * 0.29);
          index += 1;
          if (seed > 0.52 || Math.hypot(x - width * 0.5, y - 170) < 76) continue;
          glyphContext.fillStyle = `rgba(225, 232, 237, ${0.045 + seed * 0.055})`;
          glyphContext.fillText(glyphs[Math.floor(seed * glyphs.length) % glyphs.length], x, y);
        }
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      targetX = width * 0.5;
      targetY = height * 0.45;
      cursorX = targetX;
      cursorY = targetY;
      buildGlyphLayer(dpr);
    };

    const moveCursor = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      targetX = clientX - rect.left;
      targetY = clientY - rect.top;
    };

    const draw = (now: number) => {
      if (!reducedMotion) frame = requestAnimationFrame(draw);
      if (document.hidden || now - lastPaint < paintInterval) return;
      lastPaint = now;
      context.clearRect(0, 0, width, height);
      context.drawImage(glyphLayer, 0, 0, width, height);
      if (reducedMotion) return;
      context.globalCompositeOperation = "lighter";

      for (let lane = 0; lane < 2; lane += 1) {
        const y = height * (0.29 + lane * 0.3) + Math.sin(now * 0.00024 + lane * 1.7) * 14;
        const drift = (now * (lane ? 0.010 : 0.013) + lane * 210) % (width + 320) - 160;
        const gradient = context.createLinearGradient(drift - 210, y, drift + 210, y + 24);
        gradient.addColorStop(0, "rgba(80, 214, 167, 0)");
        gradient.addColorStop(0.5, lane ? "rgba(118, 167, 255, 0.14)" : "rgba(80, 214, 167, 0.16)");
        gradient.addColorStop(1, "rgba(80, 214, 167, 0)");
        context.strokeStyle = gradient;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(-30, y);
        context.bezierCurveTo(width * 0.27, y - 34, width * 0.63, y + 38, width + 30, y - 18);
        context.stroke();
      }

      cursorX += (targetX - cursorX) * 0.12;
      cursorY += (targetY - cursorY) * 0.12;
      const halo = context.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 110);
      halo.addColorStop(0, "rgba(80, 214, 167, 0.10)");
      halo.addColorStop(0.46, "rgba(112, 177, 235, 0.045)");
      halo.addColorStop(1, "rgba(80, 214, 167, 0)");
      context.fillStyle = halo;
      context.fillRect(cursorX - 110, cursorY - 110, 220, 220);

      context.globalCompositeOperation = "source-over";
    };

    const handlePointerMove = (event: PointerEvent) => moveCursor(event.clientX, event.clientY);

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", handlePointerMove);
    frame = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas className="login-effects" ref={canvasRef} aria-hidden="true" />;
}

function WindowButtons({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? "window-buttons compact" : "window-buttons"}>
      <MagneticButton onClick={() => void window.chaq.window.minimize()}><Minimize2 size={14} /></MagneticButton>
      {!compact && <MagneticButton onClick={() => void window.chaq.window.maximize()}><Square size={13} /></MagneticButton>}
      <MagneticButton onClick={() => void window.chaq.window.close()}><X size={15} /></MagneticButton>
    </div>
  );
}

function TitleBar({ user }: { user: LoginUser }): JSX.Element {
  return (
    <header className="title-bar">
      <div className="drag-title"><span className="qq-dot">Chaq</span><strong>{user.displayName}</strong><em>{roleLabel(user.role)}</em></div>
      <div className="title-actions"><WindowButtons /></div>
    </header>
  );
}

function RailButton(props: { active: boolean; title: string; icon: JSX.Element; onClick: () => void }): JSX.Element {
  return <MagneticButton className={props.active ? "rail-button active" : "rail-button"} title={props.title} onClick={props.onClick}>{React.cloneElement(props.icon, { size: 22 })}</MagneticButton>;
}

function ToolPage(props: { title: string; subtitle: string; children: React.ReactNode }): JSX.Element {
  return <section className="tool-page"><header><h2>{props.title}</h2><p>{props.subtitle}</p></header>{props.children}</section>;
}

function ProfileCard({ user, onEdit }: { user: LoginUser; onEdit: () => void }): JSX.Element {
  return (
    <SpotlightCard as="section" className="profile-card-window" spotlightColor="rgba(124, 168, 255, 0.16)">
      <header>
        <img src={user.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
        <h2>{user.displayName}</h2>
        <span>{roleLabel(user.role)}</span>
      </header>
      <div className="profile-lines">
        <div><small>UID</small><strong>{user.id}</strong></div>
        <div><small>邮箱</small><strong>{user.email || user.username}</strong></div>
        <div><small>注册时间</small><strong>{formatDateTime(user.createdAt)}</strong></div>
        <div><small>Token</small><strong>{user.tokenBalance}</strong></div>
      </div>
      <div className="profile-badges"><span>身份标记预留</span></div>
      <button className="primary-button" onClick={onEdit}><Edit3 size={16} /><ShinyText>编辑资料</ShinyText></button>
    </SpotlightCard>
  );
}

function ProfileEditPanel(props: {
  user: LoginUser;
  form: ProfileFormState;
  setForm: (form: ProfileFormState) => void;
  notice: string;
  busy: boolean;
  onSendEmailCode: () => void;
  onChooseAvatar: () => void;
  onSave: () => void;
}): JSX.Element {
  const update = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => props.setForm({ ...props.form, [key]: value });

  return (
    <section className="profile-edit-panel">
      <header>
        <h2>编辑个人资料</h2>
        <p>管理头像、昵称、登录邮箱和密码。</p>
      </header>
      <div className="profile-edit-content">
        <aside>
          <img src={props.form.avatarUrl || props.user.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
          <strong>{props.form.displayName || props.user.displayName}</strong>
          <span>UID {props.user.id}</span>
        </aside>
        <div className="profile-edit-form">
          <div className="profile-avatar-upload">
            <img src={props.form.avatarUrl || props.user.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
            <div>
              <strong>头像</strong>
              <span>本地选择图片，保存后同步到账号资料。</span>
              <button type="button" onClick={props.onChooseAvatar}><ImageIcon size={16} />上传头像</button>
            </div>
          </div>
          <label>昵称<input value={props.form.displayName} onChange={(event) => update("displayName", event.target.value)} /></label>
          <div className="profile-code-row">
            <label>绑定邮箱<input value={props.form.email} onChange={(event) => update("email", event.target.value)} /></label>
            <button type="button" onClick={props.onSendEmailCode} disabled={props.busy || !props.form.email.trim()}>发送验证码</button>
          </div>
          <label>邮箱验证码<input value={props.form.emailCode} onChange={(event) => update("emailCode", event.target.value)} placeholder="仅更换邮箱时需要" /></label>
          <label>当前密码<input type="password" value={props.form.currentPassword} onChange={(event) => update("currentPassword", event.target.value)} placeholder="仅修改密码时需要" /></label>
          <div className="profile-password-grid">
            <label>新密码<input type="password" value={props.form.newPassword} onChange={(event) => update("newPassword", event.target.value)} placeholder="8-64 位，含字母和数字" /></label>
            <label>确认新密码<input type="password" value={props.form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} /></label>
          </div>
          {props.notice && <div className="profile-notice">{props.notice}</div>}
          <button className="primary-button" onClick={props.onSave} disabled={props.busy}><Save size={16} />保存资料</button>
        </div>
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  activeSettings: UserSettings;
  settingsSection: SettingsCategory;
  openSettingsSection: (section: SettingsCategory) => void;
  saveSettings: (next: Partial<UserSettings>) => void;
  previewSettings: (next: Partial<UserSettings>) => void;
  chooseBackgroundImage: () => void;
  chooseStoragePath: (key: "localChatDataPath" | "fileStoragePath") => void;
}): JSX.Element {
  const en = props.activeSettings.language === "en";
  const text = {
    general: en ? "General" : "通用",
    appearance: en ? "Appearance" : "外观",
    messages: en ? "Notifications" : "消息提示",
    storage: en ? "Storage" : "存储",
    display: en ? "Display" : "显示",
    language: en ? "Language" : "语言",
    theme: en ? "Theme" : "主题",
    background: en ? "Background" : "背景",
    sound: en ? "Message sound" : "开启消息提示音",
    flash: en ? "Icon flash" : "图标闪烁",
    chatPath: en ? "Local chat data path" : "本地聊天数据存储位置",
    filePath: en ? "File storage path" : "文件存储位置",
    change: en ? "Change" : "更改",
    reset: en ? "Reset" : "恢复默认",
    dark: en ? "Dark" : "深色",
    light: en ? "Light" : "浅色",
    system: en ? "System" : "跟随系统",
    on: en ? "On" : "开启",
    bgOpacity: en ? "Background mask" : "背景遮罩",
    windowOpacity: en ? "Window opacity" : "窗口透明度"
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <button type="button" className={props.settingsSection === "general" ? "active" : ""} onClick={() => props.openSettingsSection("general")}><Settings size={16} />{text.general}</button>
        <button type="button" className={props.settingsSection === "appearance" ? "active" : ""} onClick={() => props.openSettingsSection("appearance")}><ImageIcon size={16} />{text.appearance}</button>
        <button type="button" className={props.settingsSection === "messages" ? "active" : ""} onClick={() => props.openSettingsSection("messages")}><Bell size={16} />{text.messages}</button>
        <button type="button" className={props.settingsSection === "storage" ? "active" : ""} onClick={() => props.openSettingsSection("storage")}><HardDrive size={16} />{text.storage}</button>
        <button type="button" className={props.settingsSection === "display" ? "active" : ""} onClick={() => props.openSettingsSection("display")}><SlidersHorizontal size={16} />{text.display}</button>
      </nav>
      <div className="settings-content">
        {props.settingsSection === "general" && <SpotlightCard as="section" className="settings-section">
          <header><h3>{text.general}</h3></header>
          <div className="settings-row">
            <div><strong><Globe size={16} />{text.language}</strong></div>
            <select value={props.activeSettings.language} onChange={(event) => props.saveSettings({ language: event.target.value as "zh" | "en" })}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="settings-row">
            <div><strong>{props.activeSettings.theme === "light" ? <Sun size={16} /> : <Moon size={16} />}{text.theme}</strong></div>
            <select value={props.activeSettings.theme} onChange={(event) => props.saveSettings({ theme: event.target.value as UserSettings["theme"] })}>
              <option value="dark">{text.dark}</option>
              <option value="light">{text.light}</option>
              <option value="system">{text.system}</option>
            </select>
          </div>
        </SpotlightCard>}

        {props.settingsSection === "appearance" && <SpotlightCard as="section" className="settings-section">
          <header><h3>{text.background}</h3></header>
          <div className="background-setting">
            <img src={props.activeSettings.backgroundUrl || coverUrl} alt="" />
            <div className="background-actions">
              <button onClick={props.chooseBackgroundImage}><ImageIcon size={16} />{text.change}</button>
              <button className="text-button" onClick={() => props.saveSettings({ backgroundUrl: null })}>{text.reset}</button>
            </div>
          </div>
        </SpotlightCard>}

        {props.settingsSection === "messages" && <SpotlightCard as="section" className="settings-section">
          <header><h3>{text.messages}</h3></header>
          <div className="settings-row">
            <div><strong><Volume2 size={16} />{text.sound}</strong></div>
            <label className="switch-row"><input type="checkbox" checked={props.activeSettings.notificationSound ?? true} onChange={(event) => props.saveSettings({ notificationSound: event.target.checked })} />{text.on}</label>
          </div>
          <div className="settings-row">
            <div><strong><BellOff size={16} />{text.flash}</strong></div>
            <label className="switch-row"><input type="checkbox" checked={props.activeSettings.iconFlash ?? true} onChange={(event) => props.saveSettings({ iconFlash: event.target.checked })} />{text.on}</label>
          </div>
        </SpotlightCard>}

        {props.settingsSection === "storage" && <SpotlightCard as="section" className="settings-section">
          <header><h3>{text.storage}</h3></header>
          <div className="settings-row storage-row">
            <div><strong><HardDrive size={16} />{text.chatPath}</strong><span>{props.activeSettings.localChatDataPath || "E:\\Environment\\Chaq\\user-data"}</span></div>
            <button onClick={() => props.chooseStoragePath("localChatDataPath")}><Folder size={16} />{text.change}</button>
          </div>
          <div className="settings-row storage-row">
            <div><strong><Folder size={16} />{text.filePath}</strong><span>{props.activeSettings.fileStoragePath || "E:\\Environment\\Chaq\\files"}</span></div>
            <button onClick={() => props.chooseStoragePath("fileStoragePath")}><Folder size={16} />{text.change}</button>
          </div>
        </SpotlightCard>}

        {props.settingsSection === "display" && <SpotlightCard as="section" className="settings-section">
          <header><h3>{text.display}</h3></header>
          <SettingRange label={text.bgOpacity} value={props.activeSettings.backgroundOpacity} min={0} max={0.85} onChange={(value) => props.previewSettings({ backgroundOpacity: value })} onCommit={(value) => props.saveSettings({ backgroundOpacity: value })} />
          <SettingRange label={text.windowOpacity} value={props.activeSettings.windowOpacity} min={0.7} max={1} onChange={(value) => props.previewSettings({ windowOpacity: value })} onCommit={(value) => props.saveSettings({ windowOpacity: value })} />
        </SpotlightCard>}
      </div>
    </div>
  );
}

function SkillEditorPage(props: {
  tab: SkillEditorTab;
  setTab: (tab: SkillEditorTab) => void;
  skill: SkillSummary | null;
  draft: SkillDraft;
  setDraft: (draft: SkillDraft) => void;
  busy: boolean;
  onBack: () => void;
  onSave: () => void;
  onPublish: () => void;
  onCopyShare: () => void;
  modelMode: ModelMode;
  setModelMode: (mode: ModelMode) => void;
  cloudProviders: ModelProviderPublic[];
  cloudProviderId: string;
  setCloudProviderId: (id: string) => void;
  selectedProvider?: ModelProviderPublic;
  cloudModel: string;
  setCloudModel: (id: string) => void;
  userModels: UserModelConfigPublic[];
  userModelId: string;
  setUserModelId: (id: string) => void;
  autoSettings: SkillAutoMessageSettings;
  saveAutoSettings: (next: Partial<SkillAutoMessageSettings>) => void;
  tokenTransactions: TokenTransaction[];
  newSkillKind: SkillKind;
  setNewSkillKind: (kind: SkillKind) => void;
  newSkillSourceFile: string;
  chooseNewSkillImportFile: () => void;
  chooseNewSkillAvatar: () => void;
  newSkillExpertField: string;
  setNewSkillExpertField: (value: string) => void;
}): JSX.Element {
  const update = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => props.setDraft({ ...props.draft, [key]: value });
  const firstExample = props.draft.examples[0] ?? { user: "", assistant: "" };
  const cloudSpent = props.tokenTransactions.filter((item) => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0);

  const tabs: Array<{ id: SkillEditorTab; label: string; icon: JSX.Element }> = [
    { id: "profile", label: "资料", icon: <User size={16} /> },
    { id: "edit", label: "编辑", icon: <Edit3 size={16} /> },
    { id: "share", label: "分享", icon: <Share2 size={16} /> },
    { id: "more", label: "更多", icon: <MoreHorizontal size={16} /> }
  ];

  if (!props.skill) {
    return (
      <section className="new-skill-page">
        <header>
          <button className="text-button" onClick={props.onBack}>返回</button>
          <div><h2>新建 Skill</h2><p>设置完成并同步服务器后，才会添加到本地列表。</p></div>
          <button className="primary-button" disabled={props.busy} onClick={props.onSave}><Check size={16} /><ShinyText disabled={props.busy}>创建 Skill</ShinyText></button>
        </header>
        <div className="new-skill-form">
          <SpotlightCard className="new-skill-hero" spotlightColor="rgba(82, 211, 178, 0.14)">
            <div className="new-skill-avatar-block">
              <img src={props.draft.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
              <button type="button" onClick={props.chooseNewSkillAvatar}><ImageIcon size={16} />上传头像</button>
              <small>保存后头像会随 Skill 同步。</small>
            </div>
            <div className="new-skill-primary-fields">
              <label>昵称<input value={props.draft.name} onChange={(event) => update("name", event.target.value)} /></label>
              <label>描述<input value={props.draft.description} onChange={(event) => update("description", event.target.value)} /></label>
              <label>类型
                <select value={props.newSkillKind} onChange={(event) => {
                  const kind = event.target.value as SkillKind;
                  props.setNewSkillKind(kind);
                  update("tags", [kind === "friend" ? "朋友" : kind === "expert" ? "专家" : kind === "partner" ? "伴侣" : "自定义"]);
                }}>
                  <option value="friend">朋友</option>
                  <option value="expert">专家</option>
                  <option value="partner">伴侣</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
            </div>
          </SpotlightCard>

          {props.newSkillKind === "friend" && (
            <SpotlightCard as="section" className="new-skill-kind-panel">
              <h3>朋友资料</h3>
              <button onClick={props.chooseNewSkillImportFile}><Upload size={16} />导入聊天记录、照片或联系方式记录</button>
              {props.newSkillSourceFile && <span>{props.newSkillSourceFile}</span>}
              <label>关系记忆<textarea value={props.draft.knowledge} onChange={(event) => update("knowledge", event.target.value)} /></label>
            </SpotlightCard>
          )}

          {props.newSkillKind === "expert" && (
            <SpotlightCard as="section" className="new-skill-kind-panel">
              <h3>专家资料</h3>
              <label>专业方向<input value={props.newSkillExpertField} onChange={(event) => props.setNewSkillExpertField(event.target.value)} placeholder="例如：法律、心理咨询、前端工程、营养学" /></label>
              <label>专业知识库搜索<input value={props.draft.knowledge} onChange={(event) => update("knowledge", event.target.value)} placeholder="输入要加入的知识库关键词" /></label>
              <label>专业描述<textarea value={props.draft.persona} onChange={(event) => update("persona", event.target.value)} /></label>
            </SpotlightCard>
          )}

          {props.newSkillKind === "partner" && (
            <SpotlightCard as="section" className="new-skill-kind-panel">
              <h3>伴侣资料</h3>
              <label>性格和个性<textarea value={props.draft.persona} onChange={(event) => update("persona", event.target.value)} /></label>
              <label>相处语气<textarea value={props.draft.tone} onChange={(event) => update("tone", event.target.value)} /></label>
            </SpotlightCard>
          )}

          {props.newSkillKind === "custom" && (
            <SpotlightCard as="section" className="new-skill-kind-panel">
              <h3>自定义资料</h3>
              <label>人格<textarea value={props.draft.persona} onChange={(event) => update("persona", event.target.value)} /></label>
              <label>知识库<textarea value={props.draft.knowledge} onChange={(event) => update("knowledge", event.target.value)} /></label>
            </SpotlightCard>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="skill-editor-page">
      <aside className="skill-profile-pane">
        <img src={props.draft.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
        <h2>{props.draft.name || "新的 Skill"}</h2>
        <p>{props.draft.description}</p>
        <nav>
          {tabs.map((tab) => (
            <button key={tab.id} className={props.tab === tab.id ? "active" : ""} onClick={() => props.setTab(tab.id)}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </nav>
        <button className="text-button" onClick={props.onBack}>返回聊天</button>
      </aside>

      <div className="skill-editor-content">
        <header>
          <div>
            <h2>{props.skill ? "Skill 详情" : "添加 Skill"}</h2>
            <p>{props.skill ? "像 QQ 联系人详情一样管理这个 Skill。" : "填写完成并同步服务器后，会添加到本地列表。"}</p>
          </div>
          <button className="primary-button" disabled={props.busy} onClick={props.onSave}><Check size={16} />{props.skill ? "保存" : "保存并同步"}</button>
        </header>

        {props.tab === "profile" && (
          <div className="editor-section">
            <div className="skill-avatar-upload">
              <img src={props.draft.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
              <div>
                <strong>头像</strong>
                <span>保存后会生成新版本并同步。</span>
                <button type="button" onClick={props.chooseNewSkillAvatar}><ImageIcon size={16} />上传头像</button>
              </div>
            </div>
            <label>名称<input value={props.draft.name} onChange={(event) => update("name", event.target.value)} /></label>
            <label>简介<input value={props.draft.description} onChange={(event) => update("description", event.target.value)} /></label>
            <label>标签<input value={props.draft.tags.join(", ")} onChange={(event) => update("tags", splitTags(event.target.value))} /></label>
          </div>
        )}

        {props.tab === "edit" && (
          <div className="editor-section two-column">
            <label>人格<textarea value={props.draft.persona} onChange={(event) => update("persona", event.target.value)} /></label>
            <label>语气<textarea value={props.draft.tone} onChange={(event) => update("tone", event.target.value)} /></label>
            <label>关系与知识<textarea value={props.draft.knowledge} onChange={(event) => update("knowledge", event.target.value)} /></label>
            <label>边界规则<textarea value={props.draft.boundaries} onChange={(event) => update("boundaries", event.target.value)} /></label>
            <label>示例用户消息<input value={firstExample.user} onChange={(event) => update("examples", [{ ...firstExample, user: event.target.value }])} /></label>
            <label>示例 Skill 回复<input value={firstExample.assistant} onChange={(event) => update("examples", [{ ...firstExample, assistant: event.target.value }])} /></label>
          </div>
        )}

        {props.tab === "share" && (
          <div className="editor-section share-section">
            <button disabled={!props.skill} onClick={props.onPublish}><Store size={16} />分享到聊天广场</button>
            <button disabled={!props.skill} onClick={props.onCopyShare}><Clipboard size={16} />复制 Skill 云端代码</button>
            <div className="share-code">chaq://skill/{props.skill?.id ?? "保存后生成"}</div>
          </div>
        )}

        {props.tab === "more" && (
          <div className="editor-section two-column">
            <label>模型来源
              <select value={props.modelMode} onChange={(event) => props.setModelMode(event.target.value as ModelMode)}>
                <option value="cloud">平台云模型</option>
                <option value="user">自己的模型</option>
              </select>
            </label>
            {props.modelMode === "cloud" ? (
              <>
                <label>云模型供应商
                  <select value={props.cloudProviderId} onChange={(event) => props.setCloudProviderId(event.target.value)}>
                    <option value="">无云模型</option>
                    {props.cloudProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                </label>
                <label>模型
                  <select value={props.cloudModel} onChange={(event) => props.setCloudModel(event.target.value)}>
                    {props.selectedProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label>自己的模型
                <select value={props.userModelId} onChange={(event) => props.setUserModelId(event.target.value)}>
                  <option value="">无自带模型</option>
                  {props.userModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </label>
            )}

            <label className="switch-row"><input type="checkbox" checked={props.autoSettings.enabled} onChange={(event) => props.saveAutoSettings({ enabled: event.target.checked })} />开启自动发消息</label>
            <label className="switch-row"><input type="checkbox" checked={props.autoSettings.doNotDisturb} onChange={(event) => props.saveAutoSettings({ doNotDisturb: event.target.checked })} />消息免打扰</label>
            <label>自动模式
              <select value={props.autoSettings.mode} onChange={(event) => props.saveAutoSettings({ mode: event.target.value as SkillAutoMessageSettings["mode"] })}>
                <option value="fixed">固定</option>
                <option value="random">随机</option>
              </select>
            </label>
            {props.autoSettings.mode === "fixed" ? (
              <>
                <label>周期
                  <select value={props.autoSettings.fixedPeriod} onChange={(event) => props.saveAutoSettings({ fixedPeriod: event.target.value as SkillAutoMessageSettings["fixedPeriod"] })}>
                    <option value="day">每天</option>
                    <option value="week">每周</option>
                    <option value="month">每月</option>
                  </select>
                </label>
                <label>消息条数<input type="number" min={1} max={99} value={props.autoSettings.fixedCount} onChange={(event) => props.saveAutoSettings({ fixedCount: Number(event.target.value) })} /></label>
              </>
            ) : (
              <>
                <label className="switch-row"><input type="checkbox" checked={props.autoSettings.randomUnlimited} onChange={(event) => props.saveAutoSettings({ randomUnlimited: event.target.checked })} />无限制 token</label>
                <label>随机 token 上限<input type="number" min={0} value={props.autoSettings.randomTokenLimit ?? 0} disabled={props.autoSettings.randomUnlimited} onChange={(event) => props.saveAutoSettings({ randomTokenLimit: Number(event.target.value) })} /></label>
              </>
            )}
            <div className="token-mini">
              <Clock size={16} />
              <span>云模型消耗</span>
              <strong>{cloudSpent} token</strong>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SkillInspector({ draft, setDraft, save, busy }: { draft: SkillDraft; setDraft: (draft: SkillDraft) => void; save: () => void; busy: boolean }): JSX.Element {
  const update = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => setDraft({ ...draft, [key]: value });
  return (
    <aside className="skill-inspector">
      <img className="cover-thumb" src={draft.avatarUrl || coverUrl} alt="" onError={fallbackImage} />
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

function ModelForm(props: {
  form: UserModelFormState;
  setForm: (form: UserModelFormState) => void;
  onKindChange: (kind: ProviderKind) => void;
  onDetect: () => void;
  onTest: () => void;
  onSave: () => void;
  status: UserModelTestStatus;
}): JSX.Element {
  const { form, setForm } = props;
  const apiKeyRequired = form.kind !== "ollama";

  return (
    <div className="panel form-panel">
      <div className="panel-title-row">
        <h3>{form.id ? "编辑自己的模型" : "添加自己的模型"}</h3>
        <button type="button" onClick={() => setForm({ id: "", apiKey: "", ...userModelPresets.openai })}><Plus size={16} />新建</button>
      </div>
      <label>模型厂商
        <select value={form.kind} onChange={(event) => props.onKindChange(event.target.value as ProviderKind)}>
          {providerKinds.map((kind) => <option key={kind} value={kind}>{userModelPresets[kind].name}</option>)}
        </select>
      </label>
      <label>显示名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：我的 DeepSeek" /></label>
      <label>接口地址<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={form.kind === "custom" ? "https://example.com/v1" : "选择厂商后自动填写"} /></label>
      <label>默认模型<input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} placeholder="例如：deepseek-chat" /></label>
      <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={apiKeyRequired ? "只保存在本机加密数据库" : "Ollama 本地模型可留空"} /></label>
      <div className="model-form-actions">
        <button type="button" onClick={props.onDetect} disabled={!form.apiKey.trim()}><Search size={16} />自动识别 API</button>
        <button type="button" onClick={props.onTest} disabled={props.status.state === "testing" || !form.baseUrl.trim() || (apiKeyRequired && !form.apiKey.trim())}><ShieldCheck size={16} />检测连接</button>
        <button className="primary-button" onClick={props.onSave}><Save size={16} />保存模型</button>
      </div>
      {props.status.message && <div className={`model-test-status ${props.status.state}`}>{props.status.message}</div>}
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

function SettingRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}): JSX.Element {
  const percent = ((props.value - props.min) / (props.max - props.min)) * 100;
  const commit = (event: React.SyntheticEvent<HTMLInputElement>) => {
    props.onCommit(Number(event.currentTarget.value));
  };

  return (
    <label className="settings-range">
      <span>
        <strong>{props.label}</strong>
        <em>{props.value.toFixed(2)}</em>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step="0.01"
        value={props.value}
        style={{ "--range-fill": `${percent}%` } as React.CSSProperties}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onPointerUp={commit}
        onBlur={commit}
        onKeyUp={commit}
      />
    </label>
  );
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

function formatSkillTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("zh-CN", sameYear ? { month: "2-digit", day: "2-digit" } : { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fallbackImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.src = coverUrl;
}

function loadRememberedAccounts(): RememberedAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("chaq.rememberedAccounts") || "[]") as RememberedAccount[];
    return parsed.filter((account) => account.sessionToken && account.user?.id);
  } catch {
    return [];
  }
}

function loadPinnedSkillIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("chaq.pinnedSkills") || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
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
