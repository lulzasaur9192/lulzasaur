import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { fetchProjectAgents } from "../api.js";
import { AgentTable } from "../components/AgentTable.js";
import type { Agent } from "../types.js";

export function ProjectAgentsPage() {
  const { currentProjectFilter } = useApp();

  const { data: rawAgents } = useApi(
    () => fetchProjectAgents(currentProjectFilter!),
    [currentProjectFilter]
  );

  if (!currentProjectFilter) {
    return <div className="loading">No project selected.</div>;
  }

  const agentList: Agent[] = (rawAgents || []).map(
    (a: any) => a.agent || a
  );

  if (agentList.length === 0) {
    return <div className="loading">No agents in this project.</div>;
  }

  return <AgentTable agents={agentList} showHeartbeat={false} />;
}
