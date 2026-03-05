import { useState } from "react";
import { Modal } from "../components/Modal.js";
import { Badge } from "../components/Badge.js";
import { useApp } from "../context/AppContext.js";
import { updateTask, approveTask, rejectTask } from "../api.js";
import type { Task, Agent } from "../types.js";

const statuses = [
  "pending",
  "assigned",
  "in_progress",
  "review_pending",
  "completed",
  "failed",
  "cancelled",
];

interface TaskEditModalProps {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskEditModal({ task, onClose, onSaved }: TaskEditModalProps) {
  const { agents } = useApp();
  const agentList = agents;

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [assignedTo, setAssignedTo] = useState(task.assignedTo || "");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const isReview = task.status === "review_pending";

  async function handleSave() {
    await updateTask(task.id, {
      title,
      description,
      status,
      priority,
      assignedTo: assignedTo || null,
    });
    onSaved();
  }

  async function handleApprove() {
    await approveTask(task.id);
    onSaved();
  }

  async function handleReject() {
    if (showRejectInput) {
      await rejectTask(task.id, rejectFeedback || "Rejected by user.");
      onSaved();
    } else {
      setShowRejectInput(true);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>Edit Task</h2>
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <label>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label>Status</label>
      <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <label>Type</label>
      <div className="task-type-display">
        <Badge className={task.type || "task"}>{task.type || "task"}</Badge>
      </div>
      <label>Priority</label>
      <input
        type="number"
        value={priority}
        onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
      />
      <label>Assigned To</label>
      <select
        value={assignedTo}
        onChange={(e) => setAssignedTo(e.target.value)}
      >
        <option value="">Unassigned</option>
        {agentList.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {task.result && (
        <>
          <label>Result</label>
          <pre className="task-result-pre">
            {JSON.stringify(task.result, null, 2)}
          </pre>
        </>
      )}
      {task.verificationNotes && (
        <>
          <label>Verification Notes</label>
          <div className="task-verification-notes">
            {task.verificationNotes}
          </div>
        </>
      )}
      {showRejectInput && (
        <>
          <label>Rejection Feedback</label>
          <input
            value={rejectFeedback}
            onChange={(e) => setRejectFeedback(e.target.value)}
            placeholder="Rejection feedback (optional)..."
          />
        </>
      )}
      <div className="modal-actions">
        {isReview && (
          <>
            <button className="btn-success" onClick={handleApprove}>
              Approve
            </button>
            <button className="btn-danger" onClick={handleReject}>
              {showRejectInput ? "Confirm Reject" : "Reject"}
            </button>
          </>
        )}
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSave}>
          Save
        </button>
      </div>
    </Modal>
  );
}
