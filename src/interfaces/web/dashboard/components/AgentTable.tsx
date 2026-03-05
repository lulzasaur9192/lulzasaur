import type { Agent } from "../types.js";
import { Badge } from "./Badge.js";
import { formatInterval } from "../utils.js";
import { useApp } from "../context/AppContext.js";

interface AgentTableProps {
  agents: Agent[];
  showHeartbeat?: boolean;
}

export function AgentTable({ agents, showHeartbeat = true }: AgentTableProps) {
  const { navigate } = useApp();

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          {showHeartbeat ? (
            <>
              <th>Model</th>
              <th>Heartbeat</th>
              <th>Created</th>
            </>
          ) : (
            <>
              <th>Depth</th>
              <th>Model</th>
              <th>Created</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => (
          <tr
            key={a.id}
            className="clickable"
            onClick={() => navigate("agent-detail", { agentId: a.id })}
          >
            <td>
              <strong>{a.name}</strong>
              {!showHeartbeat && (
                <>
                  <br />
                  <span className="agent-id-hint">
                    {a.id.substring(0, 8)}
                  </span>
                </>
              )}
            </td>
            <td>
              <Badge className={a.status}>{a.status}</Badge>
            </td>
            {showHeartbeat ? (
              <>
                <td>{a.model || "\u2014"}</td>
                <td>
                  {a.heartbeatIntervalSeconds
                    ? formatInterval(a.heartbeatIntervalSeconds)
                    : "\u2014"}
                </td>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
              </>
            ) : (
              <>
                <td>{a.depth}</td>
                <td>{a.model || "\u2014"}</td>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
