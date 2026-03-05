import { useState, useEffect, useRef } from "react";
import { useSSE } from "../context/SSEContext.js";
import { fetchAgentClaudeCodeStatus } from "../api.js";
import type { SSEClaudeCodeEvent } from "../types.js";

interface CCLine {
  type: string;
  text: string;
  timestamp: string;
}

export function ClaudeCodeTab({ agentId }: { agentId: string }) {
  const { subscribe } = useSSE();
  const [lines, setLines] = useState<CCLine[]>([]);
  const [dotClass, setDotClass] = useState("idle");
  const [statusText, setStatusText] = useState("No active session");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Fetch initial status
  useEffect(() => {
    fetchAgentClaudeCodeStatus(agentId)
      .then((res) => {
        if (res.status) {
          const s =
            typeof res.status === "string"
              ? res.status
              : JSON.stringify(res.status);
          setStatusText(s);
          if (s.startsWith("running")) setDotClass("running");
          else if (s.startsWith("error") || s.startsWith("timed_out"))
            setDotClass("error");
        }
      })
      .catch(() => {});
  }, [agentId]);

  // Subscribe to SSE events
  useEffect(() => {
    return subscribe("claude_code_output", (event: SSEClaudeCodeEvent) => {
      if (event.agentId !== agentId) return;

      setLines((prev) => {
        const next = [...prev, event];
        return next.length > 500 ? next.slice(-500) : next;
      });

      if (event.type === "start") {
        setDotClass("running");
        setStatusText(`Running: ${event.text.substring(0, 80)}`);
      } else if (event.type === "complete") {
        setDotClass("idle");
        setStatusText(event.text);
      } else if (event.type === "error") {
        setDotClass("error");
        setStatusText(event.text);
      }
    });
  }, [agentId, subscribe]);

  // Auto-scroll
  useEffect(() => {
    const body = bodyRef.current;
    if (body && body.scrollHeight - body.scrollTop - body.clientHeight < 100) {
      body.scrollTop = body.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="cc-terminal">
      <div className="cc-terminal-header">
        <div className="cc-status">
          <span className={`cc-dot ${dotClass}`} />
          <span>{statusText}</span>
        </div>
        <div className="cc-terminal-actions">
          <button onClick={() => setLines([])}>Clear</button>
          <button
            onClick={() => {
              if (bodyRef.current)
                bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
            }}
          >
            Scroll to bottom
          </button>
        </div>
      </div>
      <div className="cc-terminal-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="cc-empty">Waiting for Claude Code output...</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`cc-line ${line.type}`}>
              <span className="cc-time">
                {new Date(line.timestamp).toLocaleTimeString()}
              </span>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
