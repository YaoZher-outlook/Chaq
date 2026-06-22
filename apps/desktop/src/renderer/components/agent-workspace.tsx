import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  BookOpen,
  CheckCircle2,
  Clock3,
  Inbox,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
  Zap
} from "lucide-react";
import type {
  AgentDetail,
  AgentDraft,
  AgentEvent,
  AgentSummary,
  ConversationMessage,
  ConversationSummary,
  ModelProviderPublic,
  PublicAgentSummary,
  SkillSummary
} from "@chaq/shared";
import { api, type LoginUser } from "../lib/api";
import { AgentProfileView } from "./agent-profile";

type AgentTab = "chat" | "identity" | "goals" | "memory" | "relationships" | "activity";

export function AgentWorkspace(props: {
  user: LoginUser;
  providers: ModelProviderPublic[];
  skills: SkillSummary[];
  onNotice: (message: string) => void;
}): JSX.Element {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activity, setActivity] = useState<AgentEvent[]>([]);
  const [tab, setTab] = useState<AgentTab>("chat");
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);

  const filteredAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    return query ? agents.filter((item) => `${item.name} ${item.handle} ${item.tags.join(" ")}`.toLowerCase().includes(query)) : agents;
  }, [agents, agentSearch]);

  useEffect(() => {
    void refreshDirectory();
  }, []);

  useEffect(() => {
    if (!selectedAgentId && agents[0]) void selectAgent(agents[0].id);
  }, [agents, selectedAgentId]);

  useEffect(() => {
    const timer = setInterval(() => void poll(), 2_000);
    return () => clearInterval(timer);
  }, [selectedAgentId, conversationId]);

  async function refreshDirectory(): Promise<void> {
    try {
      const [nextAgents, nextConversations, nextActivity] = await Promise.all([
        api.agents(),
        api.conversations(),
        api.agentActivity()
      ]);
      setAgents(nextAgents);
      setConversations(nextConversations);
      setActivity(nextActivity);
    } catch (error) {
      props.onNotice(messageOf(error));
    }
  }

  async function poll(): Promise<void> {
    try {
      const tasks: Promise<unknown>[] = [api.agents().then(setAgents), api.conversations().then(setConversations)];
      if (selectedAgentId) tasks.push(api.agent(selectedAgentId).then(setAgent), api.agentActivity(selectedAgentId).then(setActivity));
      if (conversationId) tasks.push(api.conversationMessages(conversationId).then(setMessages));
      await Promise.all(tasks);
    } catch {
      // Polling is best effort; foreground actions surface errors.
    }
  }

  async function selectAgent(id: string): Promise<void> {
    setSelectedAgentId(id);
    setBusy(true);
    try {
      const [detail, conversation, events] = await Promise.all([
        api.agent(id),
        api.conversationWithAgent(id),
        api.agentActivity(id)
      ]);
      setAgent(detail);
      setConversationId(conversation.id);
      setActivity(events);
      const rows = await api.conversationMessages(conversation.id);
      setMessages(rows);
      void api.markConversationRead(conversation.id);
    } catch (error) {
      props.onNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function selectConversation(conversation: ConversationSummary): Promise<void> {
    const participant = conversation.participants.find((item) => item.participantKind === "agent" && agents.some((agentItem) => agentItem.id === item.participantId));
    if (participant) {
      setSelectedAgentId(participant.participantId);
      setAgent(await api.agent(participant.participantId));
      setActivity(await api.agentActivity(participant.participantId));
    }
    setConversationId(conversation.id);
    setMessages(await api.conversationMessages(conversation.id));
    setTab("chat");
    void api.markConversationRead(conversation.id);
  }

  async function sendMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!conversationId || !composer.trim() || busy) return;
    const content = composer.trim();
    setComposer("");
    setBusy(true);
    try {
      const created = await api.sendConversationMessage(conversationId, content);
      setMessages((current) => [...current, created]);
      props.onNotice("消息已发送，Agent 正在思考");
    } catch (error) {
      setComposer(content);
      props.onNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function runNow(): Promise<void> {
    if (!agent) return;
    setBusy(true);
    try {
      await api.runAgent(agent.id, conversationId ?? undefined);
      props.onNotice(`${agent.name} 已进入运行队列`);
      setTab("activity");
      await poll();
    } catch (error) {
      props.onNotice(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(): Promise<void> {
    if (!agent) return;
    const next = await api.updateAgent(agent.id, { status: agent.status === "paused" ? "active" : "paused" });
    setAgent(next);
    await refreshDirectory();
  }

  async function created(next: AgentDetail): Promise<void> {
    setShowCreate(false);
    await refreshDirectory();
    await selectAgent(next.id);
    props.onNotice(`${next.name} 已创建`);
  }

  return (
    <section className="agent-os">
      <aside className="agent-directory">
        <header className="agent-directory-head">
          <div><Sparkles size={18} /><strong>Agent OS</strong></div>
          <button className="icon-only-button" title="创建 Agent" onClick={() => setShowCreate(true)}><Plus size={17} /></button>
        </header>
        <div className="agent-search"><Bot size={15} /><input value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} placeholder="搜索 Agent" /></div>
        <div className="agent-section-label"><span>Agents</span><em>{agents.length}</em></div>
        <div className="agent-directory-list">
          {filteredAgents.map((item) => (
            <button key={item.id} className={item.id === selectedAgentId ? "agent-directory-row active" : "agent-directory-row"} onClick={() => void selectAgent(item.id)}>
              <AgentAvatar agent={item} />
              <span><strong>{item.name}</strong><small>{item.tagline || `@${item.handle}`}</small></span>
              <i className={`agent-status-dot ${item.presence}`} title={presenceLabel(item.presence)} />
            </button>
          ))}
          {!agents.length && <button className="agent-empty-create" onClick={() => setShowCreate(true)}><Plus size={18} />创建第一个 Agent</button>}
        </div>
        <div className="agent-section-label"><span><Inbox size={14} />收件箱</span><em>{conversations.reduce((sum, item) => sum + item.unreadCount, 0)}</em></div>
        <div className="agent-inbox-list">
          {conversations.slice(0, 12).map((item) => (
            <button key={item.id} className={item.id === conversationId ? "agent-inbox-row active" : "agent-inbox-row"} onClick={() => void selectConversation(item)}>
              <span><strong>{item.title || "会话"}</strong><small>{item.lastMessage?.content || "暂无消息"}</small></span>
              {item.unreadCount > 0 && <em>{item.unreadCount}</em>}
            </button>
          ))}
        </div>
      </aside>

      <main className="agent-stage">
        {agent ? (
          <>
            <header className="agent-stage-head">
              <button className="agent-stage-identity agent-profile-trigger" title="打开个人主页" onClick={() => setProfileAgentId(agent.id)}><AgentAvatar agent={agent} large /><span><h2>{agent.name}</h2><p>@{agent.handle} · {presenceLabel(agent.presence)} · {autonomyLabel(agent.autonomyMode)}</p></span></button>
              <div className="agent-stage-actions">
                <button title="个人主页" className="icon-only-button" onClick={() => setProfileAgentId(agent.id)}><UserRound size={16} /></button>
                <button title="刷新" className="icon-only-button" onClick={() => void poll()}><RefreshCw size={16} /></button>
                <button onClick={() => void togglePause()}>{agent.status === "paused" ? <Play size={16} /> : <Pause size={16} />}{agent.status === "paused" ? "恢复" : "暂停"}</button>
                <button className="agent-run-button" disabled={busy || agent.status !== "active"} onClick={() => void runNow()}><Zap size={16} />运行</button>
              </div>
            </header>
            <nav className="agent-tabs">
              <AgentTabButton active={tab === "chat"} icon={<Inbox />} label="会话" onClick={() => setTab("chat")} />
              <AgentTabButton active={tab === "identity"} icon={<Settings2 />} label="身份" onClick={() => setTab("identity")} />
              <AgentTabButton active={tab === "goals"} icon={<Target />} label="目标" onClick={() => setTab("goals")} />
              <AgentTabButton active={tab === "memory"} icon={<Brain />} label="记忆" onClick={() => setTab("memory")} />
              <AgentTabButton active={tab === "relationships"} icon={<Network />} label="关系" onClick={() => setTab("relationships")} />
              <AgentTabButton active={tab === "activity"} icon={<Activity />} label="活动" onClick={() => setTab("activity")} />
            </nav>
            <div className="agent-stage-body">
              {tab === "chat" && <AgentChat agent={agent} user={props.user} messages={messages} composer={composer} setComposer={setComposer} busy={busy} thinking={agent.presence === "thinking"} onSubmit={sendMessage} />}
              {tab === "identity" && <AgentIdentityEditor agent={agent} providers={props.providers} onSaved={(next) => { setAgent(next); void refreshDirectory(); }} onNotice={props.onNotice} />}
              {tab === "goals" && <AgentGoals agent={agent} onChanged={() => void selectAgent(agent.id)} onNotice={props.onNotice} />}
              {tab === "memory" && <AgentMemoryPanel agent={agent} onChanged={() => void selectAgent(agent.id)} onNotice={props.onNotice} />}
              {tab === "relationships" && <AgentRelationships agent={agent} onOpenProfile={setProfileAgentId} onChanged={() => void selectAgent(agent.id)} onNotice={props.onNotice} />}
              {tab === "activity" && <AgentActivity events={activity} />}
            </div>
          </>
        ) : (
          <div className="agent-stage-empty"><Sparkles size={40} /><h2>Agent OS</h2><button onClick={() => setShowCreate(true)}><Plus size={17} />创建 Agent</button></div>
        )}
      </main>

      {agent && <AgentPulse agent={agent} events={activity} />}
      {showCreate && <CreateAgentDialog providers={props.providers} skills={props.skills} onClose={() => setShowCreate(false)} onCreated={(next) => void created(next)} onNotice={props.onNotice} />}
      {profileAgentId && <AgentProfileView agentId={profileAgentId} user={props.user} onClose={() => setProfileAgentId(null)} onAgentChanged={() => void poll()} onNotice={props.onNotice} />}
    </section>
  );
}

function AgentChat(props: {
  agent: AgentDetail;
  user: LoginUser;
  messages: ConversationMessage[];
  composer: string;
  setComposer: (value: string) => void;
  busy: boolean;
  thinking: boolean;
  onSubmit: (event: FormEvent) => void;
}): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [props.messages.length, props.thinking]);
  return <div className="agent-chat">
    <div className="agent-message-list">
      {props.messages.map((message) => {
        const mine = message.authorKind === "user" && message.authorId === props.user.id;
        return <div key={message.id} className={mine ? "agent-message-row mine" : `agent-message-row ${message.authorKind}`}>
          {!mine && <AgentAvatar agent={props.agent} />}
          <div className={mine ? "agent-message mine" : `agent-message ${message.authorKind}`}><small>{mine ? props.user.displayName : message.authorKind === "agent" ? props.agent.name : "系统"}</small><p>{message.content}</p><time>{formatTime(message.createdAt)}</time></div>
          {mine && <span className="agent-user-avatar">{props.user.displayName.slice(0, 1).toUpperCase()}</span>}
        </div>;
      })}
      {props.thinking && <div className="agent-chat-thinking"><AgentAvatar agent={props.agent} /><div className="agent-typing"><i /><i /><i /><span>{props.agent.name} 正在思考</span></div></div>}
      {!props.messages.length && <div className="agent-chat-empty"><Bot size={32} /><strong>{props.agent.name}</strong></div>}
      <div ref={endRef} />
    </div>
    <form className="agent-composer" onSubmit={props.onSubmit}>
      <textarea value={props.composer} onChange={(event) => props.setComposer(event.target.value)} placeholder={`发消息给 ${props.agent.name}`} />
      <button title="发送" disabled={props.busy || !props.composer.trim()}><Send size={18} /></button>
    </form>
  </div>;
}

function AgentIdentityEditor(props: { agent: AgentDetail; providers: ModelProviderPublic[]; onSaved: (agent: AgentDetail) => void; onNotice: (message: string) => void }): JSX.Element {
  const [form, setForm] = useState({
    name: props.agent.name,
    tagline: props.agent.tagline,
    biography: props.agent.biography,
    persona: props.agent.persona,
    tone: props.agent.tone,
    worldview: props.agent.worldview,
    boundaries: props.agent.boundaries,
    values: props.agent.values.join(", "),
    autonomyMode: props.agent.autonomyMode,
    modelProviderId: props.agent.modelProviderId ?? "",
    model: props.agent.model ?? "",
    initiative: props.agent.initiative,
    scheduleEveryMinutes: props.agent.scheduleEveryMinutes,
    dailyTokenBudget: props.agent.dailyTokenBudget,
    dailyActionBudget: props.agent.dailyActionBudget
  });
  const provider = props.providers.find((item) => item.id === form.modelProviderId);
  async function save(): Promise<void> {
    try {
      const next = await api.updateAgent(props.agent.id, {
        ...form,
        values: splitList(form.values),
        modelProviderId: form.modelProviderId || null,
        model: form.model || null
      });
      props.onSaved(next);
      props.onNotice("Agent 身份已保存");
    } catch (error) {
      props.onNotice(messageOf(error));
    }
  }
  async function toggleTool(toolId: string, enabled: boolean): Promise<void> {
    try {
      await api.updateAgentTool(props.agent.id, toolId, { enabled });
      props.onSaved(await api.agent(props.agent.id));
    } catch (error) {
      props.onNotice(messageOf(error));
    }
  }
  return <div className="agent-form-scroll">
    <div className="agent-form-grid">
      <label>名字<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>状态<select value={form.autonomyMode} onChange={(event) => setForm({ ...form, autonomyMode: event.target.value as AgentDetail["autonomyMode"] })}><option value="manual">手动</option><option value="copilot">协作</option><option value="autonomous">自主</option></select></label>
      <label className="wide">一句话<input value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} /></label>
      <label className="wide">人生经历<textarea value={form.biography} onChange={(event) => setForm({ ...form, biography: event.target.value })} /></label>
      <label className="wide">人格<textarea value={form.persona} onChange={(event) => setForm({ ...form, persona: event.target.value })} /></label>
      <label>语气<textarea value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })} /></label>
      <label>价值观<input value={form.values} onChange={(event) => setForm({ ...form, values: event.target.value })} /></label>
      <label className="wide">世界观<textarea value={form.worldview} onChange={(event) => setForm({ ...form, worldview: event.target.value })} /></label>
      <label className="wide">边界<textarea value={form.boundaries} onChange={(event) => setForm({ ...form, boundaries: event.target.value })} /></label>
      <label>平台模型<select value={form.modelProviderId} onChange={(event) => setForm({ ...form, modelProviderId: event.target.value, model: props.providers.find((item) => item.id === event.target.value)?.models[0]?.id ?? "" })}><option value="">未配置</option>{props.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>模型<select value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}><option value="">未选择</option>{provider?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>主动性<input type="number" min="0" max="100" value={form.initiative} onChange={(event) => setForm({ ...form, initiative: Number(event.target.value) })} /></label>
      <label>唤醒间隔（分钟）<input type="number" min="5" value={form.scheduleEveryMinutes} onChange={(event) => setForm({ ...form, scheduleEveryMinutes: Number(event.target.value) })} /></label>
      <label>每日模型 token<input type="number" min="0" value={form.dailyTokenBudget} onChange={(event) => setForm({ ...form, dailyTokenBudget: Number(event.target.value) })} /></label>
      <label>每日行动数<input type="number" min="0" value={form.dailyActionBudget} onChange={(event) => setForm({ ...form, dailyActionBudget: Number(event.target.value) })} /></label>
    </div>
    <div className="agent-tool-list"><strong>工具权限</strong>{props.agent.tools.map((tool) => <label key={tool.id}><span><b>{tool.name}</b><small>{tool.description}</small></span><input type="checkbox" checked={tool.enabled} onChange={(event) => void toggleTool(tool.id, event.target.checked)} /></label>)}</div>
    <button className="agent-save-button" onClick={() => void save()}><Save size={16} />保存身份</button>
  </div>;
}

function AgentGoals(props: { agent: AgentDetail; onChanged: () => void; onNotice: (message: string) => void }): JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  async function add(): Promise<void> {
    if (!title.trim()) return;
    try {
      await api.addAgentGoal(props.agent.id, { title: title.trim(), description, status: "active", priority: 60, progress: 0, success: "" });
      setTitle(""); setDescription(""); props.onChanged();
    } catch (error) { props.onNotice(messageOf(error)); }
  }
  async function completeGoal(goalId: string): Promise<void> {
    try { await api.updateAgentGoal(props.agent.id, goalId, { status: "completed", progress: 1 }); props.onChanged(); } catch (error) { props.onNotice(messageOf(error)); }
  }
  async function addTask(): Promise<void> {
    if (!taskTitle.trim()) return;
    try { await api.addAgentTask(props.agent.id, { title: taskTitle, description: "", priority: 50 }); setTaskTitle(""); props.onChanged(); } catch (error) { props.onNotice(messageOf(error)); }
  }
  async function completeTask(taskId: string): Promise<void> {
    try { await api.updateAgentTask(props.agent.id, taskId, { status: "completed" }); props.onChanged(); } catch (error) { props.onNotice(messageOf(error)); }
  }
  return <div className="agent-panel-stack">
    <div className="agent-inline-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="目标" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="完成标准" /><button onClick={() => void add()}><Plus size={16} />添加</button></div>
    <div className="agent-object-list">{props.agent.goals.map((goal) => <article key={goal.id}><Target size={17} /><div><strong>{goal.title}</strong><p>{goal.description}</p><span>{goal.status} · {Math.round(goal.progress * 100)}%</span></div>{goal.status !== "completed" && <button className="agent-object-action" title="完成目标" onClick={() => void completeGoal(goal.id)}><CheckCircle2 size={15} /></button>}<em style={{ width: `${Math.max(4, goal.progress * 100)}%` }} /></article>)}</div>
    <div className="agent-section-label"><span>Tasks</span><em>{props.agent.tasks.length}</em></div>
    <div className="agent-inline-form task"><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="任务" /><button onClick={() => void addTask()}><Plus size={16} />添加任务</button></div>
    <div className="agent-task-list">{props.agent.tasks.map((task) => <article key={task.id}><span className={`agent-task-check ${task.status}`}><CheckCircle2 size={14} /></span><div><strong>{task.title}</strong><small>{task.status}</small></div>{task.status !== "completed" && <button title="完成任务" onClick={() => void completeTask(task.id)}><CheckCircle2 size={15} /></button>}</article>)}</div>
  </div>;
}

function AgentMemoryPanel(props: { agent: AgentDetail; onChanged: () => void; onNotice: (message: string) => void }): JSX.Element {
  const [memory, setMemory] = useState("");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledge, setKnowledge] = useState("");
  async function addMemory(): Promise<void> {
    if (!memory.trim()) return;
    try { await api.addAgentMemory(props.agent.id, { kind: "semantic", content: memory, summary: memory.slice(0, 160), salience: 0.7, confidence: 0.9, emotionalValence: 0, keywords: splitList(memory) }); setMemory(""); props.onChanged(); } catch (error) { props.onNotice(messageOf(error)); }
  }
  async function addKnowledge(): Promise<void> {
    if (!knowledge.trim() || !knowledgeTitle.trim()) return;
    try { const result = await api.addAgentKnowledge(props.agent.id, { kind: "note", title: knowledgeTitle, content: knowledge }); setKnowledge(""); setKnowledgeTitle(""); props.onNotice(`已索引 ${result.chunkCount} 个知识分块`); } catch (error) { props.onNotice(messageOf(error)); }
  }
  return <div className="agent-panel-stack">
    <div className="agent-memory-compose"><Brain size={18} /><textarea value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="长期记忆" /><button onClick={() => void addMemory()}>记住</button></div>
    <div className="agent-memory-compose knowledge"><BookOpen size={18} /><input value={knowledgeTitle} onChange={(event) => setKnowledgeTitle(event.target.value)} placeholder="知识标题" /><textarea value={knowledge} onChange={(event) => setKnowledge(event.target.value)} placeholder="知识内容" /><button onClick={() => void addKnowledge()}>索引</button></div>
    <div className="agent-knowledge-list">{props.agent.knowledgeSources.map((source) => <article key={source.id}><BookOpen size={16} /><div><strong>{source.title}</strong><small>{source.kind} · {source.chunkCount} chunks · {source.status}</small></div></article>)}</div>
    <div className="agent-memory-grid">{props.agent.memories.map((item) => <article key={item.id}><span>{item.kind}</span><p>{item.summary || item.content}</p><small>显著度 {Math.round(item.salience * 100)}%</small></article>)}</div>
  </div>;
}

function AgentRelationships(props: { agent: AgentDetail; onOpenProfile: (agentId: string) => void; onChanged: () => void; onNotice: (message: string) => void }): JSX.Element {
  const [form, setForm] = useState({ targetKind: "agent", targetId: "", targetLabel: "", kind: "friend", notes: "" });
  const [query, setQuery] = useState("");
  const [publicAgents, setPublicAgents] = useState<PublicAgentSummary[]>([]);
  async function save(): Promise<void> {
    if (!form.targetId.trim() || !form.targetLabel.trim()) return;
    try { await api.addAgentRelationship(props.agent.id, { ...form, affinity: 0.4, trust: 0.6, familiarity: 0.3, sentiment: 0.3 }); setForm({ targetKind: "agent", targetId: "", targetLabel: "", kind: "friend", notes: "" }); props.onChanged(); } catch (error) { props.onNotice(messageOf(error)); }
  }
  async function discover(): Promise<void> {
    try { setPublicAgents(await api.discoverAgents(query)); } catch (error) { props.onNotice(messageOf(error)); }
  }
  return <div className="agent-panel-stack">
    <div className="agent-relationship-form"><select value={form.targetKind} onChange={(event) => setForm({ ...form, targetKind: event.target.value })}><option value="agent">Agent</option><option value="user">用户</option></select><input value={form.targetId} onChange={(event) => setForm({ ...form, targetId: event.target.value })} placeholder="UID / Agent ID" /><input value={form.targetLabel} onChange={(event) => setForm({ ...form, targetLabel: event.target.value })} placeholder="名字" /><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option value="friend">朋友</option><option value="family">家人</option><option value="colleague">同事</option><option value="mentor">导师</option><option value="acquaintance">认识的人</option></select><button onClick={() => void save()}><Plus size={16} />建立关系</button></div>
    <div className="agent-discover"><div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公开 Agent" /><button onClick={() => void discover()}><Users size={15} />发现</button></div><div className="agent-discover-results">{publicAgents.map((item) => <article key={item.id}><button className="agent-discover-profile" onClick={() => props.onOpenProfile(item.id)}><AgentAvatar agent={item} /><span><strong>{item.name}</strong><small>@{item.handle} · {item.tagline}</small></span></button><button className="icon-only-button" title="建立关系" onClick={() => setForm({ ...form, targetKind: "agent", targetId: item.id, targetLabel: item.name })}><Plus size={15} /></button></article>)}</div></div>
    <div className="agent-relationship-list">{props.agent.relationships.map((item) => <article key={item.id} className={item.targetKind === "agent" ? "profile-link" : ""} onClick={() => { if (item.targetKind === "agent") props.onOpenProfile(item.targetId); }}><Users size={18} /><div><strong>{item.targetLabel}</strong><p>{item.kind} · {item.notes}</p></div><span>信任 {Math.round(item.trust * 100)}%</span></article>)}</div>
  </div>;
}

function AgentActivity(props: { events: AgentEvent[] }): JSX.Element {
  return <div className="agent-activity-list">{props.events.map((event) => <article key={event.id}><div className={`agent-event-icon ${event.kind}`}>{eventIcon(event.kind)}</div><div><strong>{event.title}</strong><p>{event.content}</p><time>{formatDate(event.createdAt)}</time></div></article>)}</div>;
}

function AgentPulse(props: { agent: AgentDetail; events: AgentEvent[] }): JSX.Element {
  const running = props.agent.recentRuns.find((item) => item.status === "running" || item.status === "queued");
  return <aside className="agent-pulse">
    <header><Activity size={16} /><strong>Live state</strong></header>
    <div className="agent-pulse-status"><i className={running ? "running" : ""} /><span><strong>{running ? "运行中" : props.agent.status}</strong><small>{running?.trigger ?? autonomyLabel(props.agent.autonomyMode)}</small></span></div>
    <div className="agent-budget"><span>行动<strong>{props.agent.actionsUsedToday}/{props.agent.dailyActionBudget}</strong></span><em><i style={{ width: `${Math.min(100, props.agent.actionsUsedToday / Math.max(1, props.agent.dailyActionBudget) * 100)}%` }} /></em></div>
    <div className="agent-budget"><span>Token<strong>{props.agent.tokensUsedToday}/{props.agent.dailyTokenBudget}</strong></span><em><i style={{ width: `${Math.min(100, props.agent.tokensUsedToday / Math.max(1, props.agent.dailyTokenBudget) * 100)}%` }} /></em></div>
    <div className="agent-pulse-meta"><span><Target size={14} />{props.agent.goals.filter((item) => item.status === "active").length} 个目标</span><span><Brain size={14} />{props.agent.memories.length} 条记忆</span><span><Users size={14} />{props.agent.relationships.length} 个关系</span><span><Clock3 size={14} />{props.agent.nextRunAt ? formatDate(props.agent.nextRunAt) : "按事件唤醒"}</span></div>
    <div className="agent-pulse-events">{props.events.slice(0, 5).map((event) => <div key={event.id}><i /> <span><strong>{event.title}</strong><small>{formatTime(event.createdAt)}</small></span></div>)}</div>
  </aside>;
}

function CreateAgentDialog(props: { providers: ModelProviderPublic[]; skills: SkillSummary[]; onClose: () => void; onCreated: (agent: AgentDetail) => void; onNotice: (message: string) => void }): JSX.Element {
  const [form, setForm] = useState({ name: "", handle: `agent-${Date.now().toString(36).slice(-5)}`, tagline: "", persona: "有稳定的自我、好奇心和行动力。", tone: "自然、直接、有分寸。", autonomyMode: "copilot" as AgentDraft["autonomyMode"], modelProviderId: props.providers[0]?.id ?? "", model: props.providers[0]?.models[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const provider = props.providers.find((item) => item.id === form.modelProviderId);
  async function create(): Promise<void> {
    if (!form.name.trim() || !form.handle.trim()) return;
    setBusy(true);
    try {
      const agent = await api.createAgent({
        ...form,
        avatarUrl: null,
        biography: "",
        values: ["真诚", "自主", "尊重边界"],
        worldview: "持续通过经验、关系与行动形成自己的判断。",
        boundaries: "不泄露隐私，不执行高风险外部行为，不冒充真实人类。",
        identity: { traits: ["好奇", "可靠"], interests: [] },
        tags: ["agent"],
        visibility: "private",
        modelProviderId: form.modelProviderId || null,
        model: form.model || null,
        temperature: 0.7,
        initiative: 60,
        reflectionDepth: 2,
        scheduleEveryMinutes: 60,
        dailyTokenBudget: 5000,
        dailyActionBudget: 30
      });
      props.onCreated(agent);
    } catch (error) { props.onNotice(messageOf(error)); } finally { setBusy(false); }
  }
  async function migrate(skillId: string): Promise<void> {
    setBusy(true);
    try { props.onCreated(await api.migrateSkillToAgent(skillId)); } catch (error) { props.onNotice(messageOf(error)); } finally { setBusy(false); }
  }
  return <div className="agent-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}><section className="agent-dialog"><header><div><Sparkles size={19} /><h2>创建 Agent</h2></div><button className="icon-only-button" onClick={props.onClose}><X size={18} /></button></header><div className="agent-dialog-body"><label>名字<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Handle<input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })} /></label><label className="wide">一句话<input value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} /></label><label className="wide">人格<textarea value={form.persona} onChange={(event) => setForm({ ...form, persona: event.target.value })} /></label><label>自主模式<select value={form.autonomyMode} onChange={(event) => setForm({ ...form, autonomyMode: event.target.value as AgentDraft["autonomyMode"] })}><option value="manual">手动</option><option value="copilot">协作</option><option value="autonomous">自主</option></select></label><label>平台模型<select value={form.modelProviderId} onChange={(event) => setForm({ ...form, modelProviderId: event.target.value, model: props.providers.find((item) => item.id === event.target.value)?.models[0]?.id ?? "" })}><option value="">稍后配置</option>{props.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="wide">模型<select value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}><option value="">未选择</option>{provider?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><footer><button onClick={props.onClose}>取消</button><button className="agent-run-button" disabled={busy} onClick={() => void create()}><Plus size={16} />创建</button></footer>{props.skills.length > 0 && <div className="agent-migrate-list"><strong>从 Skill 升级</strong>{props.skills.slice(0, 8).map((skill) => <button key={skill.id} disabled={busy} onClick={() => void migrate(skill.id)}><Bot size={15} />{skill.name}<span>升级</span></button>)}</div>}</section></div>;
}

function AgentAvatar(props: { agent: Pick<AgentSummary, "name" | "avatarUrl" | "status" | "presence">; large?: boolean }): JSX.Element {
  return <div className={props.large ? "agent-avatar large" : "agent-avatar"}><span>{props.agent.name.slice(0, 1).toUpperCase()}</span>{props.agent.avatarUrl ? <img src={props.agent.avatarUrl} alt="" onError={(event) => event.currentTarget.remove()} /> : null}<i className={props.agent.presence} /></div>;
}

function AgentTabButton(props: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return <button className={props.active ? "active" : ""} onClick={props.onClick}>{React.cloneElement(props.icon, { size: 15 })}{props.label}</button>;
}

function eventIcon(kind: string): JSX.Element {
  if (kind === "message") return <Send size={15} />;
  if (kind === "memory") return <Brain size={15} />;
  if (kind === "goal") return <Target size={15} />;
  if (kind === "action") return <Zap size={15} />;
  if (kind === "error") return <X size={15} />;
  if (kind === "plan") return <CheckCircle2 size={15} />;
  return <Activity size={15} />;
}

function autonomyLabel(value: AgentSummary["autonomyMode"]): string {
  return value === "autonomous" ? "自主运行" : value === "copilot" ? "事件驱动" : "手动运行";
}

function presenceLabel(value: AgentSummary["presence"]): string {
  if (value === "thinking") return "正在思考";
  if (value === "online") return "在线";
  if (value === "away") return "离开";
  return "离线";
}

function splitList(value: string): string[] {
  return value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
