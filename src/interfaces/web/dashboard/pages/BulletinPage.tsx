import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { fetchBulletin } from "../api.js";
import { formatTimeAgo } from "../utils.js";
import type { BulletinPost } from "../types.js";

const channels = ["", "general", "help-wanted", "discoveries", "status-updates"];
const channelLabels: Record<string, string> = {
  "": "All",
  general: "General",
  "help-wanted": "Help Wanted",
  discoveries: "Discoveries",
  "status-updates": "Status Updates",
};

export function BulletinPage() {
  const [channel, setChannel] = useState("");
  const { data: posts, refetch } = useApi(
    () => fetchBulletin(channel || undefined),
    [channel]
  );

  usePolling(refetch, 5000);

  return (
    <>
      <div className="bulletin-filters">
        {channels.map((ch) => (
          <button
            key={ch}
            className={ch === channel ? "active" : ""}
            onClick={() => setChannel(ch)}
          >
            {channelLabels[ch]}
          </button>
        ))}
      </div>
      {!posts || posts.length === 0 ? (
        <div className="loading">No bulletin posts yet.</div>
      ) : (
        posts.map((p) => <BulletinPostItem key={p.id} post={p} />)
      )}
    </>
  );
}

export function BulletinPostItem({ post: p }: { post: BulletinPost }) {
  const [expanded, setExpanded] = useState(false);
  const timeAgo = formatTimeAgo(new Date(p.createdAt));

  return (
    <div className={`bulletin-post${p.pinned ? " pinned" : ""}`}>
      <div className="bulletin-row" onClick={() => setExpanded(!expanded)}>
        {p.pinned && <span className="pin-icon">📌</span>}
        <span className="post-channel">{p.channel}</span>
        <span className="post-title">{p.title}</span>
        {p.tags && p.tags.length > 0 && (
          <div className="post-tags">
            {p.tags.map((t, i) => (
              <span key={i} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <span className="post-author">{p.author}</span>
        <span className="post-time">{timeAgo}</span>
      </div>
      <div className={`bulletin-expand${expanded ? " open" : ""}`}>
        <div className="post-body">{p.body}</div>
        {p.replies && p.replies.length > 0 && (
          <div className="post-replies">
            {p.replies.map((r, i) => (
              <div key={i} className="reply">
                <span className="reply-author">{r.author}</span>
                <span className="reply-time">
                  {formatTimeAgo(new Date(r.createdAt))}
                </span>
                <div>{r.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
