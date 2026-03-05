import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { Agent, Page, Project } from "../types.js";
import { fetchAgents, fetchInboxCount, fetchProjects } from "../api.js";

interface AppState {
  currentPage: Page;
  currentAgent: string | null;
  detailAgentId: string | null;
  currentProjectFilter: string | null;
  currentProjectName: string | null;
  agents: Agent[];
  projects: Project[];
  inboxCount: number;
  showTerminated: boolean;
  modalOpen: boolean;
}

interface AppContextValue extends AppState {
  navigate: (page: Page, opts?: NavigateOpts) => void;
  setAgents: (agents: Agent[]) => void;
  setCurrentAgent: (id: string | null) => void;
  setShowTerminated: (v: boolean) => void;
  setModalOpen: (v: boolean) => void;
  setInboxCount: (n: number) => void;
  refreshProjects: () => Promise<void>;
  refreshInboxCount: () => Promise<void>;
}

interface NavigateOpts {
  agentId?: string;
  projectId?: string;
  projectName?: string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    currentPage: "inbox",
    currentAgent: null,
    detailAgentId: null,
    currentProjectFilter: null,
    currentProjectName: null,
    agents: [],
    projects: [],
    inboxCount: 0,
    showTerminated: false,
    modalOpen: false,
  });

  const navigate = useCallback((page: Page, opts?: NavigateOpts) => {
    setState((s) => ({
      ...s,
      currentPage: page,
      detailAgentId: opts?.agentId ?? (page === "agent-detail" ? s.detailAgentId : null),
      currentProjectFilter: opts?.projectId ?? null,
      currentProjectName: opts?.projectName ?? null,
    }));
  }, []);

  const setAgents = useCallback((agents: Agent[]) => {
    setState((s) => ({ ...s, agents }));
  }, []);

  const setCurrentAgent = useCallback((id: string | null) => {
    setState((s) => ({ ...s, currentAgent: id }));
  }, []);

  const setShowTerminated = useCallback((showTerminated: boolean) => {
    setState((s) => ({ ...s, showTerminated }));
  }, []);

  const setModalOpen = useCallback((modalOpen: boolean) => {
    setState((s) => ({ ...s, modalOpen }));
  }, []);

  const setInboxCount = useCallback((inboxCount: number) => {
    setState((s) => ({ ...s, inboxCount }));
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const projects = await fetchProjects();
      setState((s) => ({ ...s, projects }));
    } catch { /* silent */ }
  }, []);

  const refreshInboxCount = useCallback(async () => {
    try {
      const data = await fetchInboxCount();
      setState((s) => ({ ...s, inboxCount: data.pending }));
    } catch { /* silent */ }
  }, []);

  // Initial load
  useEffect(() => {
    refreshProjects();
    refreshInboxCount();
    fetchAgents().then((agents) => {
      const list = agents.map((a: any) => a.agent || a);
      setState((s) => ({
        ...s,
        agents: list,
        currentAgent: list.length > 0 ? list[0]!.id : null,
      }));
    }).catch(() => {});
  }, [refreshProjects, refreshInboxCount]);

  return (
    <AppContext.Provider
      value={{
        ...state,
        navigate,
        setAgents,
        setCurrentAgent,
        setShowTerminated,
        setModalOpen,
        setInboxCount,
        refreshProjects,
        refreshInboxCount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
