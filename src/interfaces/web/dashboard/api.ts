import type {
  Agent,
  AgentDetail,
  BulletinPost,
  Conversation,
  Epic,
  Heartbeat,
  InboxItem,
  InboxStatus,
  Project,
  ScheduleData,
  Task,
  TokenEntry,
  TokenHourly,
  TokenSummary,
} from "./types.js";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json() as Promise<T>;
}

// ── Agents ──
export const fetchAgents = (includeTerminated = false) =>
  api<Agent[]>(
    `/api/agents${includeTerminated ? "?include_terminated=true" : ""}`
  );

export const fetchAgent = (id: string) =>
  api<AgentDetail>(`/api/agents/${id}`);

export const fetchAgentClaudeCodeStatus = (id: string) =>
  api<{ status: string | null }>(`/api/agents/${id}/claude-code-status`);

export const fetchAgentConversations = (id: string) =>
  api<Conversation[]>(`/api/agents/${id}/conversations`);

export const fetchAgentHeartbeats = (id: string) =>
  api<Heartbeat[]>(`/api/agents/${id}/heartbeats`);

export const sendAgentMessage = (id: string, text: string) =>
  api<{ response: string; toolCalls: number; tokens: number; durationMs: number }>(
    `/api/agents/${id}/message`,
    { method: "POST", body: JSON.stringify({ text }) }
  );

// ── Projects ──
export const fetchProjects = () => api<Project[]>("/api/projects");

export const fetchProjectAgents = (projectId: string) =>
  api<Array<{ agent: Agent } | Agent>>(`/api/projects/${projectId}/agents`);

export const fetchProjectEpics = (projectId: string) =>
  api<Epic[]>(`/api/projects/${projectId}/epics`);

// ── Tasks ──
export const fetchTasks = () => api<Task[]>("/api/tasks");

export const updateTask = (
  id: string,
  updates: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "assignedTo">>
) =>
  api<Task>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

export const approveTask = (id: string) =>
  api<void>(`/api/tasks/${id}/approve`, { method: "POST", body: "{}" });

export const rejectTask = (id: string, feedback: string) =>
  api<void>(`/api/tasks/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });

// ── Inbox ──
export const fetchInbox = (status: InboxStatus) =>
  api<InboxItem[]>(`/api/inbox?status=${status}`);

export const fetchInboxCount = () =>
  api<{ pending: number }>("/api/inbox/count");

export const respondToInbox = (
  id: string,
  action: string,
  message?: string
) =>
  api<void>(`/api/inbox/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ action, message: message || undefined }),
  });

// ── Bulletin ──
export const fetchBulletin = (channel?: string, projectId?: string) => {
  const params = new URLSearchParams();
  if (channel) params.set("channel", channel);
  if (projectId) params.set("projectId", projectId);
  const qs = params.toString();
  return api<BulletinPost[]>(`/api/bulletin${qs ? `?${qs}` : ""}`);
};

// ── Activity ──
export const fetchHeartbeats = () =>
  api<Heartbeat[]>("/api/activity/heartbeats");

export const fetchSchedule = () =>
  api<ScheduleData>("/api/activity/schedule");

export const fetchTokenSummary = (hours: number) =>
  api<TokenSummary>(`/api/activity/tokens/summary?hours=${hours}`);

export const fetchTokenHourly = (hours: number) =>
  api<TokenHourly[]>(`/api/activity/tokens/hourly?hours=${hours}`);

export const fetchTokenEntries = (hours: number) =>
  api<TokenEntry[]>(`/api/activity/tokens?hours=${hours}`);
