import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { fetchAgentHeartbeats } from "../api.js";
import type { Heartbeat } from "../types.js";

export function HeartbeatsTab({ agentId }: { agentId: string }) {
  const { data: heartbeats } = useApi(() => fetchAgentHeartbeats(agentId), [agentId]);

  if (!heartbeats || heartbeats.length === 0) {
    return <div className="cc-empty">No heartbeat history.</div>;
  }

  return (
    <div className="hb-timeline">
      {heartbeats.map((h) => (
        <HeartbeatCard key={h.id} heartbeat={h} />
      ))}
    </div>
  );
}

function HeartbeatCard({ heartbeat: h }: { heartbeat: Heartbeat }) {
  const [expanded, setExpanded] = useState(false);

  const time = new Date(h.triggeredAt);
  const response = h.result?.response;
  const skipped = h.result?.skipped;
  const toolCalls = h.result?.toolCalls ?? 0;
  const hasContent = !!response;

  return (
    <div
      className={`hb-card${h.error ? " error" : skipped ? " skipped" : ""}${expanded ? " expanded" : ""}`}
      onClick={() => hasContent && setExpanded(!expanded)}
    >
      <div className="hb-card-header">
        <div className="hb-card-time">
          {time.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" "}
          {time.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="hb-card-indicators">
          {h.durationMs != null && (
            <span className="hb-pill">{(h.durationMs / 1000).toFixed(1)}s</span>
          )}
          {toolCalls > 0 && (
            <span className="hb-pill tools">{toolCalls} tools</span>
          )}
          {skipped && (
            <span className="hb-pill skip">skipped</span>
          )}
          {h.error && (
            <span className="hb-pill err">error</span>
          )}
          {!h.error && !skipped && (
            <span className="hb-pill ok">OK</span>
          )}
          {hasContent && (
            <span className="hb-expand-arrow">{expanded ? "\u25B2" : "\u25BC"}</span>
          )}
        </div>
      </div>

      {!expanded && response && (
        <div className="hb-card-preview">
          {response.substring(0, 200)}
          {response.length > 200 ? "..." : ""}
        </div>
      )}

      {expanded && response && (
        <div className="hb-card-body">{response}</div>
      )}

      {h.error && (
        <div className="hb-card-error">{h.error}</div>
      )}
    </div>
  );
}
