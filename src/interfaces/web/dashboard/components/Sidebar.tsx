import { useState } from "react";
import { useApp } from "../context/AppContext.js";
import type { Page, Project } from "../types.js";

const navItems: { page: Page; label: string }[] = [
  { page: "inbox", label: "Inbox" },
  { page: "agents", label: "Agents" },
  { page: "tasks", label: "Tasks" },
  { page: "bulletin", label: "Bulletin" },
  { page: "activity", label: "Activity" },
  { page: "tokens", label: "Tokens" },
];

export function Sidebar() {
  const { currentPage, navigate, projects, inboxCount, currentProjectFilter } =
    useApp();

  return (
    <div className="sidebar" id="sidebar">
      <h1>
        <span>🦖</span> Lulzasaur
      </h1>
      <div className="nav-section">System</div>
      {navItems.map(({ page, label }) => (
        <a
          key={page}
          className={`nav-item${currentPage === page ? " active" : ""}`}
          onClick={() => navigate(page)}
        >
          {label}
          {page === "inbox" && inboxCount > 0 && (
            <span className="inbox-badge">{inboxCount}</span>
          )}
        </a>
      ))}
      {projects.length > 0 && (
        <>
          <div className="nav-section">Projects</div>
          <div id="projects-tree">
            {projects.map((p) => (
              <ProjectTreeNode
                key={p.id}
                project={p}
                currentPage={currentPage}
                currentProjectFilter={currentProjectFilter}
                navigate={navigate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectTreeNode({
  project,
  currentPage,
  currentProjectFilter,
  navigate,
}: {
  project: Project;
  currentPage: Page;
  currentProjectFilter: string | null;
  navigate: (page: Page, opts?: { projectId?: string; projectName?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = currentProjectFilter === project.id;

  const leaves: { page: Page; label: string }[] = [
    { page: "project-agents", label: "Agents" },
    { page: "project-epics", label: "Epics" },
    { page: "project-bulletin", label: "Bulletin" },
  ];

  return (
    <div className="tree-node">
      <div className="tree-toggle" onClick={() => setOpen(!open)}>
        <span className={`arrow${open ? " open" : ""}`}>&#9654;</span>
        <span
          className={`project-badge${project.active ? "" : " inactive"}`}
        />
        {project.displayName}
      </div>
      <div className={`tree-children${open ? " open" : ""}`}>
        {leaves.map(({ page, label }) => (
          <a
            key={page}
            className={`tree-leaf${
              isActive && currentPage === page ? " active" : ""
            }`}
            onClick={() =>
              navigate(page, {
                projectId: project.id,
                projectName: project.displayName,
              })
            }
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
