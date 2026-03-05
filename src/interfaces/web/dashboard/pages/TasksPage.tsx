import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { fetchTasks } from "../api.js";
import { Badge } from "../components/Badge.js";
import { TaskEditModal } from "./TaskEditModal.js";
import type { Task, TaskStatus } from "../types.js";

const columnOrder: TaskStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "review_pending",
  "completed",
  "failed",
];
const defaultCollapsed = new Set<TaskStatus>(["completed", "failed"]);

export function TasksPage() {
  const { data: tasks, refetch } = useApi(() => fetchTasks(), []);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(defaultCollapsed)
  );

  usePolling(refetch, 5000);

  const allTasks = tasks || [];
  const cols: Record<string, Task[]> = {};
  for (const status of columnOrder) {
    cols[status] = [];
  }
  for (const t of allTasks) {
    if (cols[t.status]) cols[t.status]!.push(t);
  }

  function toggleCollapse(status: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <>
      <div className="kanban">
        {columnOrder.map((status) => {
          const items = cols[status] || [];
          const isCollapsed = collapsed.has(status) && items.length > 0;

          return (
            <div
              key={status}
              className={`kanban-col${isCollapsed ? " collapsed" : ""}`}
            >
              <h3 onClick={() => toggleCollapse(status)}>
                <span className="toggle-arrow">&#9660;</span>
                {status.replace(/_/g, " ")} ({items.length})
              </h3>
              {items.map((t) => (
                <div
                  key={t.id}
                  className="kanban-card"
                  onClick={() => setEditingTask(t)}
                >
                  <div className="kanban-card-badges">
                    <Badge className={t.type}>{t.type}</Badge>
                  </div>
                  <div className="title">{t.title}</div>
                  <div className="desc">
                    {(t.description || "").substring(0, 100)}
                  </div>
                  {t.priority > 0 && (
                    <div className="priority">Priority: {t.priority}</div>
                  )}
                  <div className="kanban-card-verification">
                    <Badge className={t.verificationStatus}>
                      {t.verificationStatus}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null);
            refetch();
          }}
        />
      )}
    </>
  );
}
