import { useState, useRef } from "react";
import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { fetchInbox, respondToInbox } from "../api.js";
import { Badge } from "../components/Badge.js";
import type { InboxItem, InboxStatus } from "../types.js";

const filters: InboxStatus[] = [
  "pending",
  "approved",
  "rejected",
  "dismissed",
  "replied",
];
const filterLabels: Record<InboxStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  dismissed: "Dismissed",
  replied: "Replied",
};

export function InboxPage() {
  const { refreshInboxCount } = useApp();
  const [filter, setFilter] = useState<InboxStatus>("pending");
  const { data: items, refetch } = useApi(
    () => fetchInbox(filter),
    [filter]
  );

  usePolling(async () => {
    await refetch();
    refreshInboxCount();
  }, 5000);

  async function handleRespond(id: string, action: string, message?: string) {
    await respondToInbox(id, action, message);
    await refetch();
    refreshInboxCount();
  }

  return (
    <>
      <div className="bulletin-filters">
        {filters.map((f) => (
          <button
            key={f}
            className={f === filter ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>
      {!items || items.length === 0 ? (
        <div className="loading">No inbox items.</div>
      ) : (
        items.map((item) => (
          <InboxCard
            key={item.id}
            item={item}
            onRespond={handleRespond}
          />
        ))
      )}
    </>
  );
}

function InboxCard({
  item,
  onRespond,
}: {
  item: InboxItem;
  onRespond: (id: string, action: string, message?: string) => Promise<void>;
}) {
  const [replyText, setReplyText] = useState("");
  const [rejectText, setRejectText] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
  const time = new Date(item.createdAt).toLocaleString();
  const idPrefix = item.id.substring(0, 8);

  async function handleReply() {
    if (!replyText.trim()) {
      alert("Please enter a reply message.");
      return;
    }
    await onRespond(item.id, "reply", replyText.trim());
  }

  async function handleReject() {
    if (showRejectInput) {
      await onRespond(item.id, "reject", rejectText || "Rejected by user.");
      setShowRejectInput(false);
    } else {
      setShowRejectInput(true);
    }
  }

  return (
    <div className={`inbox-card ${item.type}`}>
      <div className="inbox-header">
        <Badge className={item.type}>{typeLabel}</Badge>
        <span className="inbox-agent-name">
          {item.agentName}
        </span>
        <span className="inbox-id">
          {idPrefix}
        </span>
      </div>
      <div className="inbox-title">{item.title}</div>
      <div className="inbox-body">{item.body}</div>
      <div className="inbox-meta">
        {time}
        {item.userResponse && ` \u00b7 Response: ${item.userResponse}`}
      </div>
      {item.status === "pending" && (
        <div className="inbox-actions">
          {item.type === "review" && (
            <>
              <button
                className="btn-success"
                onClick={() => onRespond(item.id, "approve")}
              >
                Approve
              </button>
              {showRejectInput ? (
                <>
                  <input
                    className="btn-reply-input"
                    value={rejectText}
                    onChange={(e) => setRejectText(e.target.value)}
                    placeholder="Rejection feedback..."
                  />
                  <button className="btn-danger" onClick={handleReject}>
                    Confirm Reject
                  </button>
                </>
              ) : (
                <button className="btn-danger" onClick={handleReject}>
                  Reject
                </button>
              )}
            </>
          )}
          {item.type === "proposal" && (
            <>
              <button
                className="btn-success"
                onClick={() => onRespond(item.id, "approve")}
              >
                Approve
              </button>
              <input
                className="btn-reply-input"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply..."
              />
              <button className="btn-primary" onClick={handleReply}>
                Reply
              </button>
              <button
                className="btn-ghost"
                onClick={() => onRespond(item.id, "dismiss")}
              >
                Dismiss
              </button>
            </>
          )}
          {item.type === "question" && (
            <>
              <input
                className="btn-reply-input"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Your answer..."
              />
              <button className="btn-primary" onClick={handleReply}>
                Reply
              </button>
              <button
                className="btn-ghost"
                onClick={() => onRespond(item.id, "dismiss")}
              >
                Dismiss
              </button>
            </>
          )}
          {(item.type === "update" || item.type === "alert") && (
            <>
              <input
                className="btn-reply-input"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply..."
              />
              <button className="btn-primary" onClick={handleReply}>
                Reply
              </button>
              <button
                className="btn-ghost"
                onClick={() => onRespond(item.id, "dismiss")}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
