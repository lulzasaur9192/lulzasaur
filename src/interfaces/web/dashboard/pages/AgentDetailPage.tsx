import { useState } from "react";
import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { fetchAgent } from "../api.js";
import { Badge } from "../components/Badge.js";
import { ClaudeCodeTab } from "./ClaudeCodeTab.js";
import { ConversationsTab } from "./ConversationsTab.js";
import { HeartbeatsTab } from "./HeartbeatsTab.js";

type DetailTab = "cc" | "convos" | "heartbeats";

export function AgentDetailPage() {
  const { detailAgentId, navigate, projects } = useApp();
  const [activeTab, setActiveTab] = useState<DetailTab>("cc");

  const { data: agent } = useApi(
    () => fetchAgent(detailAgentId!),
    [detailAgentId]
  );

  if (!detailAgentId || !agent) {
    return <div className="loading">Loading agent...</div>;
  }

  const proj = agent.projectId
    ? projects.find((p) => p.id === agent.projectId)
    : null;

  return (
    <>
      <div
        className="agent-detail-back"
        onClick={() => navigate("agents")}
      >
        &larr; Back to Agents
      </div>
      <div className="agent-detail-header">
        <h2>{agent.name}</h2>
        <Badge className={agent.status}>{agent.status}</Badge>
      </div>
      <div className="agent-detail-meta">
        <div className="meta-item">
          <span className="meta-label">ID</span> {agent.id.substring(0, 12)}
        </div>
        <div className="meta-item">
          <span className="meta-label">Model</span> {agent.model || "default"}
        </div>
        <div className="meta-item">
          <span className="meta-label">Depth</span> {agent.depth}
        </div>
        <div className="meta-item">
          <span className="meta-label">Project</span>{" "}
          {proj ? proj.displayName : "global"}
        </div>
        <div className="meta-item">
          <span className="meta-label">Created</span>{" "}
          {new Date(agent.createdAt).toLocaleString()}
        </div>
      </div>
      <div className="detail-tabs">
        <div
          className={`detail-tab${activeTab === "cc" ? " active" : ""}`}
          onClick={() => setActiveTab("cc")}
        >
          Claude Code
        </div>
        <div
          className={`detail-tab${activeTab === "convos" ? " active" : ""}`}
          onClick={() => setActiveTab("convos")}
        >
          Conversations
        </div>
        <div
          className={`detail-tab${activeTab === "heartbeats" ? " active" : ""}`}
          onClick={() => setActiveTab("heartbeats")}
        >
          Heartbeats
        </div>
      </div>
      <div>
        {activeTab === "cc" && <ClaudeCodeTab agentId={detailAgentId} />}
        {activeTab === "convos" && (
          <ConversationsTab agentId={detailAgentId} />
        )}
        {activeTab === "heartbeats" && (
          <HeartbeatsTab agentId={detailAgentId} />
        )}
      </div>
    </>
  );
}
