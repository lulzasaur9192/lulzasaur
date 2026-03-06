import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import {
  fetchTrash,
  restoreTrashItem,
  deleteTrashItem,
  emptyTrash,
} from "../api.js";
import { formatTimeAgo } from "../utils.js";
import type { TrashItem, TrashItemType } from "../types.js";

const typeFilters: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "message", label: "Messages" },
  { value: "bulletin_post", label: "Bulletin Posts" },
  { value: "task", label: "Tasks" },
];

const typeBadgeClass: Record<TrashItemType, string> = {
  message: "accent",
  bulletin_post: "purple",
  task: "green",
};

const typeLabel: Record<TrashItemType, string> = {
  message: "Message",
  bulletin_post: "Bulletin Post",
  task: "Task",
};

export function TrashPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const { data: items, refetch } = useApi(
    () => fetchTrash(typeFilter || undefined),
    [typeFilter],
  );

  usePolling(refetch, 5000);

  const handleRestore = async (id: string) => {
    await restoreTrashItem(id);
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteTrashItem(id);
    refetch();
  };

  const handleEmptyTrash = async () => {
    await emptyTrash();
    setConfirmEmpty(false);
    refetch();
  };

  return (
    <>
      <div className="trash-toolbar">
        <div className="bulletin-filters">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              className={f.value === typeFilter ? "active" : ""}
              onClick={() => setTypeFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {items && items.length > 0 && (
          confirmEmpty ? (
            <div className="trash-confirm">
              <span>Delete all items permanently?</span>
              <button className="btn-danger trash-confirm-btn" onClick={handleEmptyTrash}>
                Yes, empty trash
              </button>
              <button className="btn-ghost trash-confirm-btn" onClick={() => setConfirmEmpty(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-danger trash-empty-btn" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </button>
          )
        )}
      </div>

      {!items || items.length === 0 ? (
        <div className="loading">Trash is empty.</div>
      ) : (
        items.map((item) => (
          <TrashCard
            key={item.id}
            item={item}
            onRestore={() => handleRestore(item.id)}
            onDelete={() => handleDelete(item.id)}
          />
        ))
      )}
    </>
  );
}

function TrashCard({
  item,
  onRestore,
  onDelete,
}: {
  item: TrashItem;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const badgeColor = typeBadgeClass[item.itemType];

  return (
    <div className={`trash-card trash-border-${badgeColor}`}>
      <div className="trash-card-header">
        <span className={`badge ${badgeColor === "accent" ? "idle" : badgeColor === "purple" ? "in_progress" : "completed"}`}>
          {typeLabel[item.itemType]}
        </span>
        <span className="trash-card-preview">{item.preview}</span>
      </div>
      <div className="trash-card-meta">
        {item.trashedByName && (
          <span>by {item.trashedByName}</span>
        )}
        <span>{formatTimeAgo(new Date(item.trashedAt))}</span>
        {item.reason && (
          <span className="trash-card-reason">{item.reason}</span>
        )}
      </div>
      <div className="trash-actions">
        <button className="btn-success trash-action-btn" onClick={onRestore}>
          Restore
        </button>
        <button className="btn-danger trash-action-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
