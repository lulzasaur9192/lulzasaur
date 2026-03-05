import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import type { SSEClaudeCodeEvent, SSEInboxCount } from "../types.js";

type SSEEventType =
  | "agent_update"
  | "task_update"
  | "inbox_count"
  | "inbox_item"
  | "claude_code_output";

type SSEHandler = (data: any) => void;

interface SSEContextValue {
  subscribe: (event: SSEEventType, handler: SSEHandler) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export function SSEProvider({ children }: { children: ReactNode }) {
  const sourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<SSEEventType, Set<SSEHandler>>>(new Map());

  const subscribe = useCallback(
    (event: SSEEventType, handler: SSEHandler): (() => void) => {
      if (!listenersRef.current.has(event)) {
        listenersRef.current.set(event, new Set());
      }
      listenersRef.current.get(event)!.add(handler);
      return () => {
        listenersRef.current.get(event)?.delete(handler);
      };
    },
    []
  );

  useEffect(() => {
    const es = new EventSource("/api/activity/stream");
    sourceRef.current = es;

    const events: SSEEventType[] = [
      "agent_update",
      "task_update",
      "inbox_count",
      "inbox_item",
      "claude_code_output",
    ];

    for (const event of events) {
      es.addEventListener(event, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const handlers = listenersRef.current.get(event);
          if (handlers) {
            for (const h of handlers) h(data);
          }
        } catch { /* ignore parse errors */ }
      });
    }

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe }}>{children}</SSEContext.Provider>
  );
}

export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error("useSSE must be used within SSEProvider");
  return ctx;
}
