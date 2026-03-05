import { useApi } from "../hooks/useApi.js";
import { fetchAgentConversations } from "../api.js";
import type { Conversation } from "../types.js";

export function ConversationsTab({ agentId }: { agentId: string }) {
  const { data: convos } = useApi(
    () => fetchAgentConversations(agentId),
    [agentId]
  );

  if (!convos || convos.length === 0) {
    return <div className="cc-empty">No conversations yet.</div>;
  }

  return (
    <>
      {convos.map((c, i) => {
        const msgCount = (c.messages || []).length;
        const lastMsg =
          c.messages && c.messages.length > 0
            ? c.messages[c.messages.length - 1]
            : null;
        let preview = "";
        if (lastMsg) {
          if (typeof lastMsg.content === "string") {
            preview = lastMsg.content.substring(0, 120);
          } else if (Array.isArray(lastMsg.content)) {
            const txt = lastMsg.content.find((b) => b.type === "text");
            if (txt?.text) preview = txt.text.substring(0, 120);
          }
        }

        return (
          <div key={i} className="conversation-card">
            <div className="conversation-header">
              <strong>
                {c.isActive ? "Active Conversation" : "Conversation"}
              </strong>
              <span className="conversation-meta">
                {msgCount} messages &middot; {c.tokenCount || 0} tokens
              </span>
            </div>
            {preview && (
              <div className="conversation-preview">
                {preview}...
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
