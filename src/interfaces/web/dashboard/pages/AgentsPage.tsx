import { useState, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { fetchAgents, fetchHeartbeats } from "../api.js";
import { Badge } from "../components/Badge.js";
import { formatInterval } from "../utils.js";
import type { Agent, Heartbeat } from "../types.js";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AgentsPage() {
  const { showTerminated, setShowTerminated, projects, setAgents, navigate } = useApp();

  const { data: rawAgents, refetch } = useApi(
    () => fetchAgents(showTerminated),
    [showTerminated]
  );
  const { data: heartbeats } = useApi(() => fetchHeartbeats(), []);

  usePolling(refetch, 5000);

  const agentList: Agent[] = useMemo(
    () => (rawAgents || []).map((a: any) => a.agent || a),
    [rawAgents]
  );

  useEffect(() => {
    if (rawAgents) setAgents(agentList);
  }, [rawAgents, agentList, setAgents]);

  // Build a map of latest heartbeat per agent
  const latestHeartbeat: Record<string, Heartbeat> = {};
  for (const h of heartbeats || []) {
    if (!latestHeartbeat[h.agentId]) {
      latestHeartbeat[h.agentId] = h;
    }
  }

  const globalAgents = agentList.filter((a) => !a.projectId);
  const projectGroups: Record<string, Agent[]> = {};
  for (const a of agentList) {
    if (a.projectId) {
      if (!projectGroups[a.projectId]) projectGroups[a.projectId] = [];
      projectGroups[a.projectId]!.push(a);
    }
  }

  return (
    <>
      <div className="filter-row">
        <label>
          <input
            type="checkbox"
            checked={showTerminated}
            onChange={(e) => setShowTerminated(e.target.checked)}
          />
          Show terminated agents
        </label>
        <span className="agent-count">
          ({agentList.length} agents)
        </span>
      </div>

      {globalAgents.length > 0 && (
        <>
          <h3 className="section-title">Core Agents</h3>
          <div className="agent-cards-grid">
            {globalAgents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                heartbeat={latestHeartbeat[a.id]}
                onNavigate={() => navigate("agent-detail", { agentId: a.id })}
              />
            ))}
          </div>
        </>
      )}

      {Object.entries(projectGroups).map(([projectId, list]) => {
        const proj = projects.find((p) => p.id === projectId);
        const projName = proj ? proj.displayName : projectId.substring(0, 8);
        return (
          <div key={projectId}>
            <h3 className="section-title">{projName}</h3>
            <div className="agent-cards-grid">
              {list.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  heartbeat={latestHeartbeat[a.id]}
                  onNavigate={() => navigate("agent-detail", { agentId: a.id })}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function AgentCard({
  agent,
  heartbeat,
  onNavigate,
}: {
  agent: Agent;
  heartbeat?: Heartbeat;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const hbTime = heartbeat ? new Date(heartbeat.triggeredAt) : null;
  const hbResponse = heartbeat?.result?.response;
  const hbSkipped = heartbeat?.result?.skipped;
  const hbToolCalls = heartbeat?.result?.toolCalls ?? 0;
  const hbError = heartbeat?.error;
  const hbDuration = heartbeat?.durationMs;

  return (
    <div className="agent-card" onClick={onNavigate}>
      <div className="agent-card-top">
        <div className="agent-card-name">
          <strong>{agent.name}</strong>
          <Badge className={agent.status}>{agent.status}</Badge>
        </div>
        <div className="agent-card-meta">
          <span>{agent.model || "default"}</span>
          {agent.heartbeatIntervalSeconds && (
            <span>every {formatInterval(agent.heartbeatIntervalSeconds)}</span>
          )}
        </div>
      </div>

      {heartbeat && (
        <div
          className={`agent-card-heartbeat${hbError ? " error" : hbSkipped ? " skipped" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hbResponse) setExpanded(!expanded);
          }}
        >
          <div className="hb-summary-row">
            <span className="hb-time">{hbTime ? timeAgo(hbTime) : ""}</span>
            {hbDuration != null && (
              <span className="hb-duration">{(hbDuration / 1000).toFixed(1)}s</span>
            )}
            {hbToolCalls > 0 && (
              <span className="hb-tools">{hbToolCalls} tools</span>
            )}
            {hbSkipped && (
              <span className="hb-skipped-label">skipped (no work)</span>
            )}
            {hbError && (
              <span className="hb-error-label">error</span>
            )}
            {hbResponse && (
              <span className="hb-expand-hint">{expanded ? "\u25B2" : "\u25BC"}</span>
            )}
          </div>
          {!expanded && hbResponse && (
            <div className="hb-preview">
              {hbResponse.substring(0, 150)}
              {hbResponse.length > 150 ? "..." : ""}
            </div>
          )}
          {expanded && hbResponse && (
            <div className="hb-full-response">{hbResponse}</div>
          )}
          {hbError && (
            <div className="hb-error-text">{hbError}</div>
          )}
        </div>
      )}

      {!heartbeat && (
        <div className="agent-card-heartbeat skipped">
          <div className="hb-summary-row">
            <span className="hb-skipped-label">No heartbeats yet</span>
          </div>
        </div>
      )}
    </div>
  );
}
