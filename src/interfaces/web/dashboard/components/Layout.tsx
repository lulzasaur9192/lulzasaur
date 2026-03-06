import { useApp } from "../context/AppContext.js";
import { Sidebar } from "./Sidebar.js";
import { PageHeader } from "./PageHeader.js";
import { AgentsPage } from "../pages/AgentsPage.js";
import { AgentDetailPage } from "../pages/AgentDetailPage.js";
import { TasksPage } from "../pages/TasksPage.js";
import { BulletinPage } from "../pages/BulletinPage.js";
import { ActivityPage } from "../pages/ActivityPage.js";
import { TokensPage } from "../pages/TokensPage.js";
import { ProjectAgentsPage } from "../pages/ProjectAgentsPage.js";
import { ProjectEpicsPage } from "../pages/ProjectEpicsPage.js";
import { ProjectBulletinPage } from "../pages/ProjectBulletinPage.js";
import { TrashPage } from "../pages/TrashPage.js";
import type { Page } from "../types.js";

const pageTitles: Record<Page, string> = {
  agents: "Agents",
  tasks: "Tasks",
  bulletin: "Bulletin Board",
  activity: "Activity",
  tokens: "Token Usage",
  trash: "Trash",
  "agent-detail": "",
  "project-agents": "",
  "project-epics": "",
  "project-bulletin": "",
};

const pageSubtitles: Record<string, string> = {
  agents: "Monitor and manage your agent fleet",
  tasks: "Track work across projects",
  bulletin: "Agent communications and updates",
  activity: "Schedules, heartbeats, and usage",
  tokens: "API usage and cost tracking",
  trash: "Restore or permanently delete items",
};

function getPageTitle(page: Page, projectName: string | null, agentName?: string): string {
  if (page === "agent-detail") return agentName || "Agent Detail";
  if (page === "project-agents") return `${projectName} \u2014 Agents`;
  if (page === "project-epics") return `${projectName} \u2014 Epics`;
  if (page === "project-bulletin") return `${projectName} \u2014 Bulletin`;
  return pageTitles[page];
}

export function Layout() {
  const { currentPage, currentProjectName } = useApp();

  const title = getPageTitle(currentPage, currentProjectName);
  const subtitle = pageSubtitles[currentPage];

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <PageHeader title={title} subtitle={subtitle} />
        <div className="content" id="page-content">
          <PageRouter page={currentPage} />
        </div>
      </div>
    </div>
  );
}

function PageRouter({ page }: { page: Page }) {
  switch (page) {
    case "agents":
      return <AgentsPage />;
    case "agent-detail":
      return <AgentDetailPage />;
    case "tasks":
      return <TasksPage />;
    case "bulletin":
      return <BulletinPage />;
    case "activity":
      return <ActivityPage />;
    case "tokens":
      return <TokensPage />;
    case "trash":
      return <TrashPage />;
    case "project-agents":
      return <ProjectAgentsPage />;
    case "project-epics":
      return <ProjectEpicsPage />;
    case "project-bulletin":
      return <ProjectBulletinPage />;
    default:
      return <div className="loading">Unknown page</div>;
  }
}
