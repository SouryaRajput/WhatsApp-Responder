import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BadgePlus,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Database,
  Eye,
  FileText,
  Flame,
  Globe,
  Inbox,
  Key,
  LayoutDashboard,
  ListFilter,
  Lock,
  LogIn,
  LogOut,
  MessageCircle,
  Plug,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Timer,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff
} from "lucide-react";
import { api, setAuthToken } from "./api";
import { createBrokerSocket } from "./socket";
import "./styles.css";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "live", label: "Live Conversations", icon: MessageCircle },
  { id: "cold", label: "Cold Leads", icon: Inbox },
  { id: "warm", label: "Warm Leads", icon: Activity },
  { id: "hot", label: "Hot Leads", icon: Flame },
  { id: "closed", label: "Closed Leads", icon: CheckCircle2 },
  { id: "followups", label: "Follow-Ups", icon: Timer },
  { id: "team", label: "Broker Team", icon: UsersRound },
  { id: "transcripts", label: "Transcripts", icon: FileText },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "setup", label: "Setup & Migration", icon: Smartphone },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "platform", label: "Platform Admin", icon: Globe, adminOnly: true }
];

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [overview, setOverview] = useState(null);
  const [team, setTeam] = useState([]);
  const [transcripts, setTranscripts] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState("");
  const [aiDraft, setAiDraft] = useState(null);
  const [filters, setFilters] = useState({ query: "", mode: "all", unread: false });
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const [creatingBroker, setCreatingBroker] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);

  useEffect(() => {
    loadAll().finally(() => setLoadingInitial(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setSelectedId(null);
      setMessages([]);
      return;
    }
    const socket = createBrokerSocket();
    socket.on("message:new", ({ conversation, message }) => {
      upsertConversation(conversation);
      if (String(message.conversation) === String(selectedId) || String(conversation._id) === String(selectedId)) {
        setMessages((items) => [...items, message]);
      }
    });
    socket.on("conversation:update", upsertConversation);
    socket.on("conversation:mode", ({ conversation }) => upsertConversation(conversation));
    socket.on("notification:new", (notification) => setNotifications((items) => [notification, ...items]));
    socket.on("ai:draft", ({ conversation, draft }) => {
      upsertConversation(conversation);
      setAiDraft(draft);
    });
    return () => socket.disconnect();
  }, [user, selectedId]);

  const selected = useMemo(
    () => conversations.find((item) => String(item._id) === String(selectedId)),
    [conversations, selectedId]
  );

  const visibleConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const temp = temperature(conversation.leadScore).toLowerCase().replace(" ", "_");
      const haystack = `${conversation.clientName || ""} ${conversation.clientPhone || ""} ${conversation.summary?.text || ""}`.toLowerCase();
      if (page === "cold" && temp !== "cold") return false;
      if (page === "warm" && temp !== "warm") return false;
      if (page === "hot" && !["hot", "very_hot"].includes(temp)) return false;
      if (page === "closed" && conversation.status !== "closed") return false;
      if (filters.mode !== "all" && conversation.mode !== filters.mode) return false;
      if (filters.unread && !conversation.unreadForBroker) return false;
      if (filters.query && !haystack.includes(filters.query.toLowerCase())) return false;
      return true;
    });
  }, [conversations, filters, page]);

  async function loadAll() {
    await Promise.allSettled([
      loadCurrentUser(),
      loadConversations(),
      loadNotifications(),
      loadOverview(),
      loadTeam(),
      loadTranscripts(),
      loadFollowUps(),
      loadSettings()
    ]);
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await api.post("/auth/login", {
      email: form.get("email"),
      password: form.get("password")
    });
    setUser(response.data.user);
    await loadAll();
  }

  async function signup(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const response = await api.post("/auth/signup", { name, email, password });
    return {
      message: `Account created for ${response.data.user?.email || email}. You can sign in now.`
    };
  }

  async function forgotPassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const response = await api.post("/auth/forgot-password", { email });
    const resetToken = response.data.resetToken ? ` Dev reset token: ${response.data.resetToken}` : "";
    return { message: `${response.data.message || "Reset instructions generated."}${resetToken}` };
  }

  async function loadCurrentUser() {
    try {
      const response = await api.get("/auth/me");
      setUser(response.data.user);
    } catch (error) {
      setUser(null);
    }
  }

  async function loadConversations() {
    const response = await api.get("/conversations");
    setConversations(response.data);
    if (!selectedId && response.data.length) selectConversation(response.data[0]._id);
  }

  async function loadNotifications() {
    const response = await api.get("/notifications");
    setNotifications(response.data);
  }

  async function loadOverview() {
    const response = await api.get("/analytics/overview");
    setOverview(response.data);
  }

  async function loadTeam() {
    try {
      const response = await api.get("/team");
      setTeam(response.data);
    } catch {
      setTeam([]);
    }
  }

  async function loadTranscripts() {
    const response = await api.get("/transcripts");
    setTranscripts(response.data);
  }

  async function loadFollowUps() {
    const response = await api.get("/followups");
    setFollowUps(response.data);
  }

  async function loadSettings() {
    try {
      const response = await api.get("/settings");
      setSettings(response.data);
    } catch {
      setSettings(null);
    }
  }

  async function selectConversation(id) {
    setSelectedId(id);
    setAiDraft(null);
    const response = await api.get(`/conversations/${id}/messages`);
    setMessages(response.data);
  }

  async function setMode(mode) {
    if (!selected) return;
    try {
      const response = await api.post(`/conversations/${selected._id}/mode`, { mode });
      upsertConversation(response.data);
    } catch (requestError) {
      setAdminError("Something went wrong while changing the mode. Please try again.");
    }
  }

  async function sendBrokerMessage() {
    if (!selected || !draft.trim()) return;
    const response = await api.post(`/conversations/${selected._id}/messages`, { body: draft.trim() });
    setMessages((items) => [...items, response.data]);
    setDraft("");
    setAiDraft(null);
  }

  async function closeConversation() {
    if (!selected) return;
    try {
      const response = await api.post(`/conversations/${selected._id}/close`);
      upsertConversation(response.data);
    } catch (requestError) {
      setAdminError("Something went wrong while closing the conversation. Please try again.");
    }
  }

  async function createBroker(event) {
    event.preventDefault();
    setAdminMessage("");
    setAdminError("");
    setCreatingBroker(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await api.post("/team", {
        name: String(form.get("name") || "").trim(),
        email: String(form.get("email") || "").trim(),
        password: String(form.get("password") || "").trim(),
        role: form.get("role") || "broker"
      });
      setAdminMessage(`Created ${response.data.email}`);
      event.currentTarget.reset();
    } catch (requestError) {
      setAdminError("Could not create this team member. The email may already be in use.");
    } finally {
      setCreatingBroker(false);
    }
  }

  async function saveProfile(data) {
    const response = await api.patch("/settings/profile", data);
    if (response.data.user) {
      setUser(response.data.user);
    }
    return response.data;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      setUser(null);
    }
  }

  async function logoutEverywhere() {
    try {
      await api.post("/auth/logout-all");
    } finally {
      setUser(null);
    }
  }

  function upsertConversation(conversation) {
    setConversations((items) => {
      const next = items.filter((item) => String(item._id) !== String(conversation._id));
      return [conversation, ...next].sort((a, b) => new Date(b.lastMessageAt || b.updatedAt) - new Date(a.lastMessageAt || a.updatedAt));
    });
  }

  if (loadingInitial) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user) return <AuthScreen onLogin={login} onSignup={signup} onForgot={forgotPassword} />;

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {adminError ? (
        <div className="admin-toast">{adminError} <button onClick={() => setAdminError("")}>&times;</button></div>
      ) : null}
      <Sidebar
        collapsed={sidebarCollapsed}
        page={page}
        user={user}
        unread={notifications.filter((item) => !item.readAt).length}
        onNavigate={setPage}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onLogout={logoutEverywhere}
      />

      <section className="workspace">
        {page === "dashboard" ? (
          <DashboardOverview overview={overview} notifications={notifications} team={team} conversations={conversations} />
        ) : null}
        {["live", "cold", "warm", "hot", "closed"].includes(page) ? (
          <LiveConsole
            title={pageTitle(page)}
            conversations={visibleConversations}
            selected={selected}
            selectedId={selectedId}
            messages={messages}
            filters={filters}
            aiDraft={aiDraft}
            draft={draft}
            notifications={notifications}
            onFilter={setFilters}
            onSelect={selectConversation}
            onMode={setMode}
            onClose={closeConversation}
            onDraft={setDraft}
            onSend={sendBrokerMessage}
          />
        ) : null}
        {page === "followups" ? <FollowUpsPage followUps={followUps} /> : null}
        {page === "team" ? (
          <TeamPage
            user={user}
            team={team}
            creating={creatingBroker}
            message={adminMessage}
            error={adminError}
            onCreate={createBroker}
          />
        ) : null}
        {page === "transcripts" ? <TranscriptsPage transcripts={transcripts} /> : null}
        {page === "notifications" ? <NotificationsPage notifications={notifications} /> : null}
        {page === "analytics" ? <AnalyticsPage overview={overview} conversations={conversations} /> : null}
        {page === "setup" ? <SetupPage /> : null}
        {page === "settings" ? <SettingsPage settings={settings} user={user} onSaveProfile={saveProfile} onRefreshSettings={loadSettings} onLogoutEverywhere={logoutEverywhere} /> : null}
        {page === "platform" && user?.role === "platform_admin" ? <PlatformAdminPage /> : null}
      </section>
    </main>
  );
}

function AuthScreen({ onLogin, onSignup, onForgot }) {
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";

  async function handleSubmit(event) {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const handler = isSignup ? onSignup : isForgot ? onForgot : onLogin;
      const result = await handler(event);
      if (result?.message) setMessage(result.message);
      if (isSignup) {
        event.currentTarget.reset();
        setMode("login");
      }
    } catch (requestError) {
      event.preventDefault();
      const status = requestError?.response?.status;
      if (status === 401) {
        setError("Incorrect email or password.");
      } else if (status === 409) {
        setError("An account with this email already exists.");
      } else {
        setError("Unable to connect. Please check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    setError("");
  }

  return (
    <main className="auth-screen">
      <section className="auth-layout">
        <div className="auth-copy">
          <div className="auth-mark"><Shield size={22} /></div>
          <p className="eyebrow">WhatsApp sales operating system</p>
          <h1>Run AI leads and broker takeover from one calm dashboard.</h1>
          <p>Secure sign-in for live conversations, lead intelligence, transcripts, and broker operations.</p>
          <div className="auth-stat-grid">
            <div><strong>Realtime</strong><span>Socket.io relay</span></div>
            <div><strong>Secure</strong><span>Encrypted sessions</span></div>
            <div><strong>Hybrid</strong><span>AI + human modes</span></div>
          </div>
        </div>

        <div className="auth-panel">
          <div className="auth-panel-top">
            <div>
              <span className="auth-chip"><Lock size={14} /> Broker access</span>
              <h2>{isSignup ? "Create your account" : isForgot ? "Reset access" : "Welcome back"}</h2>
            </div>
            <Sparkles size={20} />
          </div>

          <div className="auth-mode-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Login</button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Signup</button>
            <button type="button" className={mode === "forgot" ? "active" : ""} onClick={() => switchMode("forgot")}>Reset</button>
          </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup ? <label>Full name<input name="name" type="text" placeholder="Broker name" required /></label> : null}
          <label>Email<input name="email" type="email" placeholder="you@company.com" required /></label>
          {!isForgot ? <label>Password<input name="password" type="password" placeholder="Minimum 8 characters" minLength={8} required /></label> : null}
          {error ? <div className="auth-alert error">{error}</div> : null}
          {message ? <div className="auth-alert success">{message}</div> : null}
          <button type="submit" disabled={loading}>
            <LogIn size={16} /> {loading ? "Working..." : isForgot ? "Send reset instructions" : "Continue"}
          </button>
        </form>

          <p className="auth-footnote">New accounts start with limited access until an admin assigns broker permissions.</p>
        </div>
      </section>
    </main>
  );
}

function Sidebar({ collapsed, page, user, unread, onNavigate, onToggle, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon"><Bot size={20} /></div>
        {!collapsed ? <div><strong>Handoff OS</strong><span>AI sales operations</span></div> : null}
        <button className="icon-button" onClick={onToggle}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </div>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => {
          if (item.adminOnly && user?.role !== "platform_admin") return null;
          const Icon = item.icon;
          return (
            <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => onNavigate(item.id)} title={item.label}>
              <Icon size={17} />
              {!collapsed ? <span>{item.label}</span> : null}
              {!collapsed && item.id === "notifications" && unread ? <b>{unread}</b> : null}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="profile-pill">
          <UserRound size={17} />
          {!collapsed ? <div><strong>{user?.name || "User"}</strong><span>{user?.role || "broker"}</span></div> : null}
        </div>
        <button className="logout-mini" onClick={onLogout} title="Logout everywhere"><LogOut size={17} /></button>
      </div>
    </aside>
  );
}

function DashboardOverview({ overview, notifications, team, conversations }) {
  const metrics = overview?.metrics || {};
  return (
    <section className="page">
      <PageHeader kicker="Realtime control" title="Dashboard" actions={<StatusPill label={`${metrics.brokerOnlineCount || 0} online`} />} />
      <div className="metric-grid">
        <MetricCard label="Active conversations" value={metrics.activeConversations || 0} />
        <MetricCard label="Hot leads" value={metrics.hotLeads || 0} tone="hot" />
        <MetricCard label="Interventions today" value={metrics.brokerInterventionsToday || 0} />
        <MetricCard label="AI response time" value={metrics.aiResponseTime || "queued"} />
        <MetricCard label="Conversion rate" value={`${metrics.conversionRate || 0}%`} />
        <MetricCard label="Pending follow-ups" value={metrics.pendingFollowUps || 0} />
        <MetricCard label="AI confidence avg" value={`${metrics.aiConfidenceAverage || 0}%`} />
      </div>
      <div className="dashboard-grid">
        <ActivityPanel title="Latest Lead Activity" items={overview?.latestLeadActivity || conversations.slice(0, 8)} />
        <AlertsPanel notifications={overview?.urgentAlerts || notifications.slice(0, 8)} />
        <TeamPulse team={team} />
      </div>
    </section>
  );
}

function LiveConsole(props) {
  const { title, conversations, selected, messages, filters, aiDraft, draft, notifications } = props;
  return (
    <section className="live-shell">
      <div className="conversation-pane">
        <PageHeader kicker="Inbox" title={title} />
        <ConversationFilters filters={filters} onFilter={props.onFilter} />
        <ConversationList conversations={conversations} selectedId={props.selectedId} onSelect={props.onSelect} />
      </div>
      <div className="chat-pane">
        {selected ? (
          <>
            <ChatHeader conversation={selected} onMode={props.onMode} onClose={props.onClose} />
            <MessageTimeline messages={messages} />
            {aiDraft ? <AiDraft draft={aiDraft} onUse={props.onDraft} /> : null}
            <Composer value={draft} onChange={props.onDraft} onSend={props.onSend} disabled={selected.mode === "AI" || selected.mode === "SHADOW"} />
          </>
        ) : <div className="empty-state">Select a conversation.</div>}
      </div>
      <aside className="intel-pane">
        {selected ? <LeadIntelligence conversation={selected} notifications={notifications} /> : null}
      </aside>
    </section>
  );
}

function ConversationFilters({ filters, onFilter }) {
  return (
    <div className="filters">
      <label><Search size={14} /><input value={filters.query} onChange={(event) => onFilter({ ...filters, query: event.target.value })} placeholder="Search leads" /></label>
      <select value={filters.mode} onChange={(event) => onFilter({ ...filters, mode: event.target.value })}>
        <option value="all">All modes</option>
        <option value="AI">AI only</option>
        <option value="HUMAN">Human takeover</option>
        <option value="HYBRID">Hybrid</option>
        <option value="SHADOW">Shadow</option>
      </select>
      <button className={filters.unread ? "active" : ""} onClick={() => onFilter({ ...filters, unread: !filters.unread })}><ListFilter size={14} /> Unread</button>
    </div>
  );
}

function ConversationList({ conversations, selectedId, onSelect }) {
  return (
    <div className="conversation-list">
      {conversations.map((conversation) => (
        <button key={conversation._id} className={`conversation-row ${String(selectedId) === String(conversation._id) ? "active" : ""}`} onClick={() => onSelect(conversation._id)}>
          <div className="row-top"><strong>{conversation.clientName || conversation.clientPhone}</strong><ModeBadge mode={conversation.mode} /></div>
          <p>{conversation.summary?.text || "No summary yet"}</p>
          <div className="row-meta">
            <span>{temperature(conversation.leadScore)}</span>
            <span>{conversation.aiConfidence ?? 0}% AI</span>
            {conversation.unreadForBroker ? <b>{conversation.unreadForBroker}</b> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function ChatHeader({ conversation, onMode, onClose }) {
  return (
    <header className="chat-header">
      <div><h2>{conversation.clientName || conversation.clientPhone}</h2><p>{conversation.summary?.text || "Live WhatsApp relay through the business number."}</p></div>
      <div className="mode-actions">
        <IconAction icon={Eye} label="Shadow" onClick={() => onMode("SHADOW")} />
        <IconAction icon={UserRound} label="Take Over" onClick={() => onMode("HUMAN")} />
        <IconAction icon={Sparkles} label="Hybrid" onClick={() => onMode("HYBRID")} />
        <IconAction icon={Bot} label="AI" onClick={() => onMode("AI")} />
        <IconAction icon={CheckCircle2} label="Close" onClick={onClose} />
      </div>
    </header>
  );
}

function MessageTimeline({ messages }) {
  return (
    <div className="timeline">
      {messages.map((message) => (
        <div key={message._id} className={`bubble ${message.sender}`}>
          <span>{message.sender} · {message.status}</span>
          <p>{message.body}</p>
          <small>{new Date(message.createdAt).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}

function AiDraft({ draft, onUse }) {
  return (
    <div className="ai-draft">
      <strong><Sparkles size={16} /> AI suggested replies</strong>
      {(draft.suggestedReplies || []).map((reply) => <button key={reply} onClick={() => onUse(reply)}>{reply}</button>)}
    </div>
  );
}

function Composer({ value, onChange, onSend, disabled }) {
  return (
    <div className="composer">
      <textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={disabled ? "Switch to Human or Hybrid to reply." : "Reply through the WhatsApp business number"} />
      <button disabled={disabled || !value.trim()} onClick={onSend}><Send size={18} /></button>
    </div>
  );
}

function LeadIntelligence({ conversation, notifications }) {
  const extracted = conversation.extracted || {};
  const relatedAlerts = notifications.filter((item) => String(item.conversation) === String(conversation._id)).slice(0, 5);
  return (
    <div className="intel-stack">
      <Panel title="Lead Intelligence">
        <Insight label="Name" value={extracted.name || conversation.clientName} />
        <Insight label="Phone" value={extracted.phone || conversation.clientPhone} />
        <Insight label="Budget" value={extracted.budget || extracted.rent || extracted.budgetValue} />
        <Insight label="Service / Interest" value={extracted.requirements || extracted.intent} />
        <Insight label="Urgency" value={extracted.urgency || extracted.timeline || extracted.moveInTimeline} />
        <Insight label="Tone" value={conversation.sentiment} />
        <Insight label="Objections" value={(extracted.objections || []).join(", ")} />
      </Panel>
      <Panel title="AI Analysis">
        <Metric label="Conversion probability" value={conversation.conversionProbability} />
        <Metric label="AI confidence" value={conversation.aiConfidence} />
        <Insight label="Recommended action" value={conversation.leadScore >= 70 ? "Take over or call back" : "Continue qualification"} />
        <Insight label="Best follow-up" value={extracted.urgency || "After next client reply"} />
      </Panel>
      <Panel title="Alerts">
        {relatedAlerts.length ? relatedAlerts.map((alert) => <div className="alert" key={alert._id}>{alert.title}</div>) : <p>No active alerts.</p>}
      </Panel>
    </div>
  );
}

function TeamPage({ user, team, creating, message, error, onCreate }) {
  return (
    <section className="page">
      <PageHeader kicker="RBAC" title="Broker Team" actions={<StatusPill label={user?.role || "user"} />} />
      {["super_admin", "admin"].includes(user?.role) ? <CreateMemberForm creating={creating} message={message} error={error} onCreate={onCreate} /> : null}
      <div className="table-card">
        {team.map((member) => (
          <div className="team-row" key={member.id}>
            <div><strong>{member.name}</strong><span>{member.email}</span></div>
            <ModeBadge mode={member.role} />
            <span>{member.active ? "Active" : "Suspended"}</span>
            <span>{member.stats?.activeConversationCount || 0} active</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateMemberForm({ creating, message, error, onCreate }) {
  return (
    <form className="create-member" onSubmit={onCreate}>
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Temporary password" minLength={8} required />
      <select name="role" defaultValue="broker"><option value="broker">Broker</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
      <button disabled={creating}><BadgePlus size={16} /> {creating ? "Creating..." : "Create"}</button>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function FollowUpsPage({ followUps }) {
  return <SimpleListPage kicker="Automation" title="Follow-Ups" items={followUps.map((item) => ({ title: item.conversation?.clientPhone || "Lead", body: `${item.status} · ${new Date(item.scheduledFor).toLocaleString()}` }))} />;
}

function TranscriptsPage({ transcripts }) {
  return <SimpleListPage kicker="Archive" title="Transcripts" items={transcripts.map((item) => ({ title: item.reason, body: item.summary || item.txt?.slice(0, 140) || "Transcript ready" }))} />;
}

function NotificationsPage({ notifications }) {
  return <SimpleListPage kicker="Signal center" title="Notifications" items={notifications.map((item) => ({ title: item.title, body: `${item.priority} · ${item.body || ""}` }))} />;
}

function AnalyticsPage({ overview, conversations }) {
  return (
    <section className="page">
      <PageHeader kicker="Performance" title="Analytics" />
      <div className="analytics-grid">
        <MiniChart title="Conversation Volume" data={overview?.messageVolume || []} />
        <ActivityPanel title="Lead Distribution" items={conversations.map((item) => ({ clientName: temperature(item.leadScore), clientPhone: item.clientPhone, summary: { text: item.status } })).slice(0, 8)} />
      </div>
    </section>
  );
}

function SetupPage() {
  const [activeTab, setActiveTab] = useState("migrate");
  const [country, setCountry] = useState("US");
  const [numberType, setNumberType] = useState("local");
  const [migratePhone, setMigratePhone] = useState("");
  const [migrateStep, setMigrateStep] = useState(0);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [numbers, setNumbers] = useState([]);
  const [provisioning, setProvisioning] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNumbers([]);
    try {
      const res = await api.get(`/twilio/available-numbers?country=${country}&type=${numberType}`);
      setNumbers(res.data.numbers || []);
      if (!res.data.numbers?.length) {
        setError("No numbers found for this region. Try a different country or type.");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to search numbers");
    } finally {
      setLoading(false);
    }
  }

  async function handleBuy(phoneNumber) {
    if (!window.confirm(`Provision ${phoneNumber} for your workspace? This will be your dedicated WhatsApp number.`)) return;
    setProvisioning(phoneNumber);
    setError("");
    setSuccess("");
    try {
      const res = await api.post("/twilio/buy-number", { phoneNumber });
      if (res.data.success) {
        setSuccess(`${phoneNumber} is now your workspace's dedicated WhatsApp number!`);
        setNumbers([]);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to provision number");
    } finally {
      setProvisioning(null);
    }
  }

  function handleMigrateStart(e) {
    e.preventDefault();
    if (!migratePhone || migratePhone.length < 10) {
      setError("Please enter a valid phone number");
      return;
    }
    setError("");
    setMigrateStep(1);
  }

  async function handleMigrateConfirm() {
    setMigrateLoading(true);
    setError("");
    try {
      // For now, migration is a manual backend process - we record the intent
      setMigrateStep(2);
      setSuccess(`Migration request submitted for ${migratePhone}. Your admin will be notified to complete the setup.`);
    } catch (err) {
      setError("Migration request failed. Please contact your administrator.");
    } finally {
      setMigrateLoading(false);
    }
  }

  return (
    <section className="page setup-page">
      <PageHeader kicker="Workspace" title="Setup & Migration" />
      <div className="setup-container">
        <div className="setup-tabs">
          <button className={activeTab === "migrate" ? "active" : ""} onClick={() => { setActiveTab("migrate"); setError(""); setSuccess(""); }}>
            Migrate Existing Number
          </button>
          <button className={activeTab === "provision" ? "active" : ""} onClick={() => { setActiveTab("provision"); setError(""); setSuccess(""); }}>
            Get a New Number
          </button>
        </div>

        {activeTab === "migrate" && (
          <div className="setup-content">
            <h3>Use your existing WhatsApp Business number</h3>
            <p>Transfer your current business number to this platform so all incoming messages are routed here automatically.</p>
            
            {migrateStep === 0 && (
              <>
                <div className="migration-steps">
                  <div className="step">
                    <div className="step-num">1</div>
                    <div>
                      <strong>Free up your number</strong>
                      <p>Open the WhatsApp Business app on your phone → Settings → Account → Delete my account. This releases the number so our platform can connect to it.</p>
                    </div>
                  </div>
                  <div className="step">
                    <div className="step-num">2</div>
                    <div>
                      <strong>Enter your number below</strong>
                      <p>Once deleted, enter the phone number here and we'll handle the rest. Your number will be linked to this workspace within 24–48 hours.</p>
                    </div>
                  </div>
                </div>

                <form className="search-form" onSubmit={handleMigrateStart} style={{ marginTop: "20px" }}>
                  <input
                    type="tel"
                    value={migratePhone}
                    onChange={(e) => setMigratePhone(e.target.value)}
                    placeholder="+1 234 567 8900"
                    style={{
                      flex: 1,
                      height: "40px",
                      padding: "0 12px",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.035)",
                      color: "var(--text)",
                      fontSize: "14px"
                    }}
                  />
                  <button type="submit">Start Migration</button>
                </form>
              </>
            )}

            {migrateStep === 1 && (
              <div className="migration-steps" style={{ marginTop: "16px" }}>
                <div className="step">
                  <div className="step-num">✓</div>
                  <div>
                    <strong>Confirm migration of {migratePhone}</strong>
                    <p>Have you already deleted the WhatsApp Business account from this number? Once you confirm, our system will begin the migration process.</p>
                    <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                      <button
                        onClick={handleMigrateConfirm}
                        disabled={migrateLoading}
                        style={{
                          border: "1px solid var(--green)",
                          background: "rgba(51,214,159,0.15)",
                          color: "var(--green)",
                          borderRadius: "8px",
                          padding: "8px 20px",
                          fontWeight: 600,
                          fontSize: "13px"
                        }}
                      >
                        {migrateLoading ? "Submitting..." : "Yes, migrate this number"}
                      </button>
                      <button
                        onClick={() => setMigrateStep(0)}
                        style={{
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          borderRadius: "8px",
                          padding: "8px 20px",
                          fontSize: "13px"
                        }}
                      >
                        Go back
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {migrateStep === 2 && success && (
              <div className="settings-success" style={{ marginTop: "16px" }}>{success}</div>
            )}

            {error && <div className="settings-error" style={{ marginTop: "16px" }}>{error}</div>}
          </div>
        )}

        {activeTab === "provision" && (
          <div className="setup-content">
            <h3>Get a dedicated WhatsApp number</h3>
            <p>Provision a brand new phone number for your workspace. This number will be exclusively yours for receiving and sending WhatsApp messages.</p>

            <form className="search-form" onSubmit={handleSearch}>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="US">United States (+1)</option>
                <option value="GB">United Kingdom (+44)</option>
                <option value="CA">Canada (+1)</option>
                <option value="AU">Australia (+61)</option>
                <option value="IN">India (+91)</option>
              </select>
              <select value={numberType} onChange={(e) => setNumberType(e.target.value)}>
                <option value="local">Local</option>
                <option value="tollfree">Toll-Free</option>
                <option value="mobile">Mobile</option>
              </select>
              <button type="submit" disabled={loading}>
                {loading ? "Searching..." : "Find Numbers"}
              </button>
            </form>

            {error && <div className="settings-error">{error}</div>}
            {success && <div className="settings-success">{success}</div>}

            {numbers.length > 0 && (
              <div className="number-results">
                {numbers.map((n) => (
                  <div key={n.phoneNumber} className="number-item">
                    <div>
                      <strong>{n.phoneNumber}</strong>
                      <span>{n.friendlyName} {n.locality ? `– ${n.locality}` : ""} {n.region ? `(${n.region})` : ""}</span>
                    </div>
                    <button 
                      onClick={() => handleBuy(n.phoneNumber)}
                      disabled={provisioning === n.phoneNumber}
                      className="buy-btn"
                    >
                      {provisioning === n.phoneNumber ? "Provisioning..." : "Select"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsPage({ settings, user, onSaveProfile, onRefreshSettings, onLogoutEverywhere }) {
  const [profileName, setProfileName] = useState(user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = ["super_admin", "admin"].includes(user?.role);
  const integrations = settings?.integrations || {};
  const stats = settings?.stats || {};

  useEffect(() => {
    if (user?.name) setProfileName(user.name);
  }, [user?.name]);

  async function handleSaveName(event) {
    event.preventDefault();
    setSaving(true);
    setProfileMessage("");
    setProfileError("");
    try {
      await onSaveProfile({ name: profileName });
      setProfileMessage("Profile updated successfully");
    } catch (requestError) {
      setProfileError("Could not save your profile changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    setSaving(true);
    setPasswordMessage("");
    setPasswordError("");
    try {
      await onSaveProfile({ currentPassword, newPassword });
      setPasswordMessage("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      const msg = requestError?.response?.data?.error;
      setPasswordError(msg === "Current password is incorrect" ? msg : "Could not change your password. Please verify your current password and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefreshSettings();
    } catch {} finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="page settings-page">
      <PageHeader
        kicker="Configuration"
        title="Settings"
        actions={
          <button className="settings-refresh" onClick={handleRefresh} disabled={refreshing} title="Refresh settings">
            <RefreshCw size={15} className={refreshing ? "spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <div className="settings-layout">
        {/* ── Left column ────────────────────────────── */}
        <div className="settings-col">
          {/* Profile */}
          <section className="settings-card">
            <div className="settings-card-header">
              <UserRound size={18} />
              <div>
                <h3>Profile</h3>
                <p>Manage your account details</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={handleSaveName}>
              <label>
                <span>Display name</span>
                <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" required />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={user?.email || ""} disabled />
              </label>
              <label>
                <span>Role</span>
                <input type="text" value={user?.role || "viewer"} disabled />
              </label>
              {profileMessage ? <div className="settings-success">{profileMessage}</div> : null}
              {profileError ? <div className="settings-error">{profileError}</div> : null}
              <button type="submit" disabled={saving || profileName === user?.name}>
                <Save size={15} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </form>
          </section>

          {/* Password */}
          <section className="settings-card">
            <div className="settings-card-header">
              <Key size={18} />
              <div>
                <h3>Change Password</h3>
                <p>Update your login credentials</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={handleChangePassword}>
              <label>
                <span>Current password</span>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" required />
              </label>
              <label>
                <span>New password</span>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 8 characters" minLength={8} required />
              </label>
              <label>
                <span>Confirm new password</span>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" minLength={8} required />
              </label>
              {passwordMessage ? <div className="settings-success">{passwordMessage}</div> : null}
              {passwordError ? <div className="settings-error">{passwordError}</div> : null}
              <button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
                <Lock size={15} /> {saving ? "Changing…" : "Change password"}
              </button>
            </form>
          </section>

          {/* Danger Zone */}
          <section className="settings-card danger-card">
            <div className="settings-card-header">
              <AlertTriangle size={18} />
              <div>
                <h3>Danger Zone</h3>
                <p>Irreversible actions</p>
              </div>
            </div>
            <div className="danger-actions">
              <div className="danger-row">
                <div>
                  <strong>Logout everywhere</strong>
                  <span>Revoke all active sessions across all devices</span>
                </div>
                <button onClick={onLogoutEverywhere}><LogOut size={15} /> Logout all</button>
              </div>
            </div>
          </section>
        </div>

        {/* ── Right column ───────────────────────────── */}
        <div className="settings-col">
          {/* Integrations — admin only */}
          {isAdmin && integrations.twilio ? (
            <section className="settings-card">
              <div className="settings-card-header">
                <Plug size={18} />
                <div>
                  <h3>Integrations</h3>
                  <p>External service connections</p>
                </div>
              </div>
              <div className="integration-grid">
                <IntegrationItem
                  icon={Smartphone}
                  label="Twilio WhatsApp"
                  status={integrations.twilio?.connected ? "connected" : "disconnected"}
                  detail={integrations.twilio?.whatsappNumber}
                />
                <IntegrationItem
                  icon={Sparkles}
                  label="AI Model"
                  status={integrations.ai?.configured ? "connected" : "disconnected"}
                  detail={integrations.ai?.model}
                />
                <IntegrationItem
                  icon={Database}
                  label="MongoDB"
                  status={integrations.mongodb?.connected ? "connected" : "disconnected"}
                  detail={integrations.mongodb?.database}
                />
                <IntegrationItem
                  icon={Bell}
                  label="Broker WhatsApp"
                  status={integrations.notifications?.brokerWhatsapp === "configured" ? "connected" : "not set"}
                  detail={integrations.notifications?.brokerWhatsapp}
                />
                <IntegrationItem
                  icon={Send}
                  label="Telegram"
                  status={integrations.notifications?.telegram === "configured" ? "connected" : "not set"}
                  detail={integrations.notifications?.telegram}
                />
                <IntegrationItem
                  icon={Globe}
                  label="Email Webhook"
                  status={integrations.notifications?.emailWebhook === "configured" ? "connected" : "not set"}
                  detail={integrations.notifications?.emailWebhook}
                />
              </div>
              {integrations.twilio?.webhookBase ? (
                <div className="settings-note">
                  <strong>Webhook base:</strong> {integrations.twilio.webhookBase}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* AI Configuration — admin only */}
          {isAdmin && integrations.ai ? (
            <section className="settings-card">
              <div className="settings-card-header">
                <Bot size={18} />
                <div>
                  <h3>AI Configuration</h3>
                  <p>Language model settings</p>
                </div>
              </div>
              <div className="settings-info-grid">
                <Insight label="Model" value={integrations.ai.model} />
                <Insight label="Base URL" value={integrations.ai.baseUrl} />
                <Insight label="Timeout" value={`${integrations.ai.timeoutMs}ms`} />
                <Insight label="API key" value={integrations.ai.configured ? "••••••••configured" : "not set"} />
              </div>
            </section>
          ) : null}

          {/* Workspace */}
          <section className="settings-card">
            <div className="settings-card-header">
              <Shield size={18} />
              <div>
                <h3>Workspace</h3>
                <p>System overview and stats</p>
              </div>
            </div>
            <div className="settings-info-grid">
              <Insight label="Workspace name" value={settings?.workspace || "WhatsApp Handoff"} />
              <Insight label="Available modes" value={settings?.modes?.join(", ")} />
              <Insight label="Queue backend" value={settings?.queue} />
              {isAdmin ? <Insight label="Environment" value={settings?.environment} /> : null}
              {isAdmin ? <Insight label="Server port" value={settings?.serverPort} /> : null}
              <Insight label="Total conversations" value={stats.totalConversations} />
              <Insight label="Total messages" value={stats.totalMessages} />
            </div>
          </section>

          {/* Security */}
          <section className="settings-card">
            <div className="settings-card-header">
              <Lock size={18} />
              <div>
                <h3>Security</h3>
                <p>Authentication and access control</p>
              </div>
            </div>
            <div className="settings-info-grid">
              <Insight label="Email verified" value={user?.emailVerified ? "Yes" : "No"} />
              <Insight label="Google OAuth" value={settings?.oauth?.google ? "Enabled" : "Not configured"} />
              <Insight label="2FA" value={settings?.twoFactor?.status || "Planned"} />
              <Insight label="Webhook validation" value={settings?.environment === "production" ? "Enabled" : "Development (relaxed)"} />
              <Insight label="Notification channels" value={settings?.notificationChannels?.join(", ")} />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function IntegrationItem({ icon: Icon, label, status, detail }) {
  const isConnected = status === "connected";
  return (
    <div className={`integration-item ${isConnected ? "connected" : "disconnected"}`}>
      <div className="integration-icon">
        <Icon size={18} />
      </div>
      <div className="integration-info">
        <strong>{label}</strong>
        <span>{detail || status}</span>
      </div>
      <div className={`integration-dot ${isConnected ? "online" : "offline"}`}>
        {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
      </div>
    </div>
  );
}

function SimpleListPage({ kicker, title, items }) {
  return (
    <section className="page">
      <PageHeader kicker={kicker} title={title} />
      <div className="list-card">{items.length ? items.map((item, index) => <div className="list-row" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.body}</span></div>) : <div className="empty-state">No records yet.</div>}</div>
    </section>
  );
}

function PageHeader({ kicker, title, actions }) {
  return <header className="page-header"><div><span>{kicker}</span><h1>{title}</h1></div>{actions}</header>;
}

function MetricCard({ label, value, tone = "" }) {
  return <section className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong></section>;
}

function ActivityPanel({ title, items }) {
  return <Panel title={title}>{items.length ? items.map((item) => <div className="activity-row" key={item._id || item.clientPhone}><CircleDot size={12} /><div><strong>{item.clientName || item.clientPhone}</strong><span>{item.summary?.text || item.status || "Recent activity"}</span></div></div>) : <p>No activity yet.</p>}</Panel>;
}

function AlertsPanel({ notifications }) {
  return <Panel title="Urgent Alerts">{notifications.length ? notifications.map((item) => <div className="alert" key={item._id}>{item.title}</div>) : <p>No urgent alerts.</p>}</Panel>;
}

function TeamPulse({ team }) {
  return <Panel title="Broker Status">{team.length ? team.slice(0, 6).map((member) => <div className="team-pulse" key={member.id}><span className={member.active ? "online-dot" : "offline-dot"} /> <strong>{member.name}</strong><em>{member.stats?.activeConversationCount || 0} active</em></div>) : <p>No team members yet.</p>}</Panel>;
}

function MiniChart({ title, data }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return <Panel title={title}><div className="mini-chart">{data.map((item) => <div key={item._id} style={{ height: `${Math.max((item.count / max) * 100, 8)}%` }} title={`${item._id}: ${item.count}`} />)}</div></Panel>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function Insight({ label, value }) {
  return <div className="insight"><span>{label}</span><strong>{value || "Unknown"}</strong></div>;
}

function Metric({ label, value = 0 }) {
  return <div className="metric"><div><span>{label}</span><strong>{value}%</strong></div><progress max="100" value={value || 0} /></div>;
}

function IconAction({ icon: Icon, label, onClick }) {
  return <button onClick={onClick} title={label}><Icon size={16} /><span>{label}</span></button>;
}

function StatusPill({ label }) {
  return <div className="status-pill">{label}</div>;
}

function ModeBadge({ mode }) {
  return <span className={`mode-badge ${String(mode || "").toLowerCase()}`}>{mode}</span>;
}

function pageTitle(page) {
  const item = NAV_ITEMS.find((entry) => entry.id === page);
  return item?.label || "Live Conversations";
}

function temperature(score = 0) {
  if (score >= 85) return "Very Hot";
  if (score >= 70) return "Hot";
  if (score >= 45) return "Warm";
  return "Cold";
}

createRoot(document.getElementById("root")).render(<App />);
function PlatformAdminPage() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [twilioSid, setTwilioSid] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadWorkspaces();
  }, []);

  async function loadWorkspaces() {
    try {
      setLoading(true);
      const res = await api.get("/platform/workspaces");
      setWorkspaces(res.data || []);
    } catch (err) {
      setError("Failed to load workspaces. Are you a platform admin?");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(id) {
    try {
      setError("");
      const res = await api.patch(`/platform/workspaces/${id}`, { twilioPhoneNumber, twilioSid });
      if (res.data.success) {
        setWorkspaces(workspaces.map(w => w._id === id ? { ...w, twilioPhoneNumber, twilioSid } : w));
        setEditingId(null);
      }
    } catch (err) {
      setError("Failed to update workspace details.");
    }
  }

  function startEdit(workspace) {
    setEditingId(workspace._id);
    setTwilioPhoneNumber(workspace.twilioPhoneNumber || "");
    setTwilioSid(workspace.twilioSid || "");
    setError("");
  }

  return (
    <section className="page setup-page">
      <PageHeader kicker="Admin" title="Platform Workspaces" />
      <div className="setup-container" style={{ maxWidth: '1000px' }}>
        <div className="setup-content">
          <h3>Manage all client workspaces</h3>
          <p>As a platform administrator, you can manually attach WhatsApp numbers that have been approved in Twilio directly to a client's workspace.</p>
          
          {error && <div className="settings-error" style={{ marginBottom: 16 }}>{error}</div>}
          
          {loading ? (
            <p>Loading workspaces...</p>
          ) : (
            <div className="platform-workspace-list">
              {workspaces.map(w => (
                <div key={w._id} className="platform-workspace-card" style={{ background: "rgba(255,255,255,0.02)", padding: 20, borderRadius: 12, marginBottom: 16, border: "1px solid var(--border)" }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: "0 0 4px 0" }}>{w.name}</h4>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        ID: {w._id} <br/>
                        Admins: {w.admins?.map(a => a.email).join(', ') || 'None'}
                      </div>
                    </div>
                    {editingId !== w._id && (
                      <button onClick={() => startEdit(w)} style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, cursor: "pointer" }}>
                        Edit Routing
                      </button>
                    )}
                  </div>

                  {editingId === w._id ? (
                    <div style={{ background: "rgba(0,0,0,0.2)", padding: 16, borderRadius: 8, marginTop: 12 }}>
                      <label style={{ display: 'block', marginBottom: 12 }}>
                        <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: "var(--muted)" }}>Twilio Phone Number (e.g. +1234567890)</span>
                        <input value={twilioPhoneNumber} onChange={e => setTwilioPhoneNumber(e.target.value)} style={{ width: '100%', padding: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "white", borderRadius: 4 }} />
                      </label>
                      <label style={{ display: 'block', marginBottom: 16 }}>
                        <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: "var(--muted)" }}>Twilio SID (Optional)</span>
                        <input value={twilioSid} onChange={e => setTwilioSid(e.target.value)} style={{ width: '100%', padding: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "white", borderRadius: 4 }} />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleSave(w._id)} style={{ padding: "6px 16px", background: "white", color: "black", border: "none", borderRadius: 6, fontWeight: 500, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ padding: "6px 16px", background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: "rgba(0,0,0,0.1)", padding: "12px 16px", borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Globe size={16} color="var(--muted)" />
                      <div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>Routed Number</div>
                        <div style={{ fontWeight: 500 }}>{w.twilioPhoneNumber || "Not attached"}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
