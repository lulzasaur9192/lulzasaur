import { useState } from "react";
import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { fetchProjectEpics } from "../api.js";
import { Badge } from "../components/Badge.js";
import { TaskEditModal } from "./TaskEditModal.js";
import type { Epic, Task } from "../types.js";

export function ProjectEpicsPage() {
  const { currentProjectFilter } = useApp();
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const { data: epics, refetch } = useApi(
    () => fetchProjectEpics(currentProjectFilter!),
    [currentProjectFilter]
  );

  if (!currentProjectFilter) {
    return <div className="loading">No project selected.</div>;
  }

  if (!epics || epics.length === 0) {
    return <div className="loading">No epics in this project yet.</div>;
  }

  // Build task cache for modal
  const allTasks: Task[] = [];
  for (const epic of epics) {
    allTasks.push(...epic.children);
  }

  return (
    <>
      {epics.map((epic) => (
        <div key={epic.id} className="epic-card">
          <div className="epic-badges">
            <Badge className="epic">epic</Badge>
            <Badge className={epic.status}>
              {epic.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="epic-title">{epic.title}</div>
          <div className="epic-desc">
            {(epic.description || "").substring(0, 200)}
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${epic.progress}%` }}
            />
          </div>
          <div className="progress-text">
            {epic.progress}% complete (
            {epic.children.filter((c) => c.status === "completed").length}/
            {epic.children.length} tasks)
          </div>
          {epic.children.length > 0 && (
            <div className="child-tasks">
              {epic.children.map((c) => (
                <div
                  key={c.id}
                  className="child-task"
                  onClick={() => setEditingTask(c)}
                >
                  <Badge
                    className={c.status}
                  >
                    {c.status.replace(/_/g, " ")}
                  </Badge>
                  <span>{c.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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
