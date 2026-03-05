export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lulzasaur Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
    .app { display: flex; height: 100vh; }
    .sidebar { width: 240px; background: var(--surface); border-right: 1px solid var(--border); padding: 16px; flex-shrink: 0; overflow-y: auto; }
    .sidebar h1 { font-size: 18px; margin-bottom: 24px; color: var(--accent); }
    .sidebar h1 span { font-size: 22px; }
    .nav-section { font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-top: 20px; margin-bottom: 6px; padding: 0 12px; letter-spacing: 0.5px; }
    .nav-item { display: block; padding: 7px 12px; margin: 1px 0; border-radius: 6px; color: var(--text-muted); cursor: pointer; text-decoration: none; font-size: 13px; }
    .nav-item:hover, .nav-item.active { background: var(--border); color: var(--text); }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .header { padding: 16px 24px; border-bottom: 1px solid var(--border); font-size: 16px; font-weight: 600; }
    .content { flex: 1; overflow-y: auto; padding: 24px; }

    /* Tree nodes */
    .tree-node { padding-left: 12px; }
    .tree-toggle { display: flex; align-items: center; gap: 6px; padding: 6px 12px; margin: 1px 0; border-radius: 6px; color: var(--text-muted); cursor: pointer; font-size: 13px; }
    .tree-toggle:hover { background: var(--border); color: var(--text); }
    .tree-toggle .arrow { font-size: 10px; transition: transform 0.15s; display: inline-block; width: 12px; }
    .tree-toggle .arrow.open { transform: rotate(90deg); }
    .tree-children { display: none; padding-left: 8px; }
    .tree-children.open { display: block; }
    .tree-leaf { display: block; padding: 5px 12px 5px 20px; margin: 1px 0; border-radius: 6px; color: var(--text-muted); cursor: pointer; text-decoration: none; font-size: 12px; }
    .tree-leaf:hover, .tree-leaf.active { background: var(--border); color: var(--text); }
    .project-badge { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 6px; }
    .project-badge.inactive { background: var(--text-muted); }

    /* Chat */
    .chat-container { display: flex; flex-direction: column; height: 100%; }
    .chat-messages { flex: 1; overflow-y: auto; padding-bottom: 16px; }
    .chat-msg { margin: 8px 0; padding: 10px 14px; border-radius: 8px; max-width: 80%; font-size: 14px; line-height: 1.5; }
    .chat-msg.user { background: var(--accent); color: #fff; margin-left: auto; }
    .chat-msg.assistant { background: var(--surface); border: 1px solid var(--border); }
    .chat-msg .meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
    .chat-input { display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
    .chat-input input { flex: 1; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; outline: none; }
    .chat-input input:focus { border-color: var(--accent); }
    .chat-input button { padding: 10px 20px; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; }
    tr:hover { background: var(--surface); }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: #1f2937; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge.idle { background: #1f6feb33; color: var(--accent); }
    .badge.active { background: #3fb95033; color: var(--green); }
    .badge.sleeping { background: #d2992233; color: var(--yellow); }
    .badge.terminated { background: #f8514933; color: var(--red); }
    .badge.pending { background: #d2992233; color: var(--yellow); }
    .badge.assigned { background: #1f6feb33; color: var(--accent); }
    .badge.in_progress { background: #bc8cff33; color: var(--purple); }
    .badge.review_pending { background: #d2992233; color: var(--yellow); }
    .badge.completed { background: #3fb95033; color: var(--green); }
    .badge.failed { background: #f8514933; color: var(--red); }
    .badge.unverified { background: #d2992233; color: var(--yellow); }
    .badge.verified { background: #3fb95033; color: var(--green); }
    .badge.rejected { background: #f8514933; color: var(--red); }
    .badge.epic { background: #bc8cff33; color: var(--purple); }
    .badge.task { background: #1f6feb33; color: var(--accent); }
    .badge.review { background: #d2992233; color: var(--yellow); }
    .badge.proposal { background: #bc8cff33; color: var(--purple); }
    .badge.question { background: #1f6feb33; color: var(--accent); }
    .badge.alert { background: #f8514933; color: var(--red); }
    .badge.update { background: #39d35333; color: #39d353; }

    /* Kanban */
    .kanban { display: flex; gap: 16px; overflow-x: auto; }
    .kanban-col { min-width: 250px; flex: 1; }
    .kanban-col h3 { font-size: 13px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px; cursor: pointer; user-select: none; }
    .kanban-col h3 .toggle-arrow { display: inline-block; font-size: 10px; margin-right: 4px; transition: transform 0.15s; }
    .kanban-col.collapsed h3 .toggle-arrow { transform: rotate(-90deg); }
    .kanban-col.collapsed .kanban-card { display: none; }
    .kanban-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
    .kanban-card:hover { border-color: var(--accent); }
    .kanban-card .title { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
    .kanban-card .desc { font-size: 12px; color: var(--text-muted); }
    .kanban-card .priority { font-size: 11px; color: var(--yellow); margin-top: 4px; }

    /* Epic cards */
    .epic-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 14px; }
    .epic-card .epic-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .epic-card .epic-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
    .epic-card .progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .epic-card .progress-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width 0.3s; }
    .epic-card .progress-text { font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
    .epic-card .child-tasks { border-top: 1px solid var(--border); padding-top: 10px; }
    .epic-card .child-task { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; cursor: pointer; }
    .epic-card .child-task:hover { color: var(--accent); }

    /* Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 560px; max-height: 80vh; overflow-y: auto; }
    .modal h2 { font-size: 16px; margin-bottom: 16px; }
    .modal label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; margin-top: 12px; text-transform: uppercase; }
    .modal input, .modal select, .modal textarea { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: inherit; outline: none; }
    .modal input:focus, .modal select:focus, .modal textarea:focus { border-color: var(--accent); }
    .modal textarea { min-height: 80px; resize: vertical; }
    .modal-actions { display: flex; gap: 8px; margin-top: 20px; justify-content: flex-end; }
    .modal-actions button { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-danger { background: var(--red); color: #fff; }
    .btn-success { background: var(--green); color: #fff; }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border) !important; }
    .btn-ghost:hover { color: var(--text); }

    /* Bulletin — Reddit-style collapsed posts */
    .bulletin-filters { display: flex; gap: 8px; margin-bottom: 16px; }
    .bulletin-filters button { padding: 6px 14px; border-radius: 16px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; }
    .bulletin-filters button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .bulletin-post { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 4px; }
    .bulletin-post.pinned { border-color: var(--yellow); }
    .bulletin-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; }
    .bulletin-row:hover { background: var(--bg); }
    .bulletin-row .post-channel { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--border); color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-title { font-size: 13px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bulletin-row .post-author { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-time { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-tags { display: flex; gap: 4px; }
    .bulletin-row .tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #1f6feb33; color: var(--accent); }
    .bulletin-row .pin-icon { color: var(--yellow); font-size: 12px; }
    .bulletin-expand { display: none; padding: 0 14px 14px 14px; border-top: 1px solid var(--border); }
    .bulletin-expand.open { display: block; }
    .bulletin-expand .post-body { font-size: 13px; color: var(--text-muted); line-height: 1.6; white-space: pre-wrap; padding: 12px 0; }
    .bulletin-expand .post-replies { margin-top: 8px; padding-left: 16px; border-left: 2px solid var(--border); }
    .bulletin-expand .reply { padding: 6px 0; font-size: 12px; }
    .bulletin-expand .reply .reply-author { color: var(--accent); font-weight: 600; }
    .bulletin-expand .reply .reply-time { color: var(--text-muted); font-size: 11px; margin-left: 8px; }

    /* Activity */
    .activity-item { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .activity-item .time { color: var(--text-muted); font-size: 11px; }

    /* Schedule heatmap */
    .schedule-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .schedule-tabs button { padding: 6px 14px; border-radius: 16px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; }
    .schedule-tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .schedule-heatmap { overflow-x: auto; }
    .schedule-heatmap table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .schedule-heatmap th { font-size: 10px; color: var(--text-muted); padding: 4px 2px; text-align: center; font-weight: 500; }
    .schedule-heatmap th.day-header { font-size: 11px; font-weight: 600; color: var(--text); border-bottom: 2px solid var(--border); }
    .schedule-heatmap th.today { color: var(--accent); }
    .schedule-heatmap td.agent-name { font-size: 12px; font-weight: 600; white-space: nowrap; padding: 6px 8px; position: sticky; left: 0; background: var(--bg); z-index: 1; border-right: 1px solid var(--border); }
    .schedule-heatmap td.heat-cell { padding: 0; text-align: center; min-width: 18px; height: 26px; border: 1px solid transparent; }
    .schedule-heatmap td.heat-cell .cell { display: block; width: 100%; height: 100%; border-radius: 2px; }
    .heat-0 { background: var(--surface); }
    .heat-1 { background: #1a3a2a; }
    .heat-2 { background: #1e5c3a; }
    .heat-3 { background: #238636; }
    .heat-4 { background: #2ea043; }
    .heat-5 { background: #3fb950; }
    .schedule-legend { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px; color: var(--text-muted); }
    .schedule-legend .swatch { width: 14px; height: 14px; border-radius: 2px; }
    .schedule-agent-summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
    .schedule-agent-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; font-size: 12px; display: flex; align-items: center; gap: 8px; }
    .schedule-agent-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
    .schedule-agent-chip .dot.idle { background: var(--green); }
    .schedule-agent-chip .dot.active { background: var(--yellow); }
    .schedule-agent-chip .interval { color: var(--text-muted); }

    /* Inbox */
    .inbox-card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 10px; }
    .inbox-card.review { border-left-color: var(--yellow); }
    .inbox-card.proposal { border-left-color: var(--purple); }
    .inbox-card.question { border-left-color: var(--accent); }
    .inbox-card.alert { border-left-color: var(--red); }
    .inbox-card.update { border-left-color: #39d353; }
    .inbox-card .inbox-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .inbox-card .inbox-title { font-size: 14px; font-weight: 600; }
    .inbox-card .inbox-body { font-size: 13px; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap; margin-bottom: 12px; }
    .inbox-card .inbox-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
    .inbox-card .inbox-actions { display: flex; gap: 8px; }
    .inbox-card .inbox-actions button { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; }
    .inbox-card .inbox-actions .btn-reply-input { flex: 1; padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 12px; outline: none; }
    .inbox-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--red); color: #fff; font-size: 11px; font-weight: 700; margin-left: 6px; }

    /* Agent Detail */
    .agent-detail-back { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: pointer; font-size: 13px; margin-bottom: 16px; padding: 4px 0; }
    .agent-detail-back:hover { color: var(--accent); }
    .agent-detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .agent-detail-header h2 { font-size: 20px; font-weight: 600; }
    .agent-detail-meta { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; font-size: 13px; color: var(--text-muted); }
    .agent-detail-meta .meta-item { display: flex; align-items: center; gap: 6px; }
    .agent-detail-meta .meta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .detail-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
    .detail-tab { padding: 8px 16px; font-size: 13px; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
    .detail-tab:hover { color: var(--text); }
    .detail-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .detail-tab-content { display: none; }
    .detail-tab-content.active { display: block; }

    /* Claude Code Terminal */
    .cc-terminal { background: #010409; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .cc-terminal-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .cc-terminal-header .cc-status { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .cc-terminal-header .cc-dot { width: 8px; height: 8px; border-radius: 50%; }
    .cc-dot.running { background: var(--green); animation: pulse 1.5s infinite; }
    .cc-dot.idle { background: var(--text-muted); }
    .cc-dot.error { background: var(--red); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .cc-terminal-body { padding: 12px 14px; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 12px; line-height: 1.6; color: var(--text); max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .cc-terminal-body .cc-line { padding: 1px 0; }
    .cc-terminal-body .cc-line.start { color: var(--accent); }
    .cc-terminal-body .cc-line.complete { color: var(--green); }
    .cc-terminal-body .cc-line.error { color: var(--red); }
    .cc-terminal-body .cc-line.status { color: var(--yellow); }
    .cc-terminal-body .cc-line .cc-time { color: var(--text-muted); margin-right: 8px; font-size: 11px; }
    .cc-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
    .cc-terminal-actions { display: flex; gap: 8px; }
    .cc-terminal-actions button { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; }
    .cc-terminal-actions button:hover { color: var(--text); border-color: var(--text-muted); }

    .loading { color: var(--text-muted); font-style: italic; }
    .agent-select { margin-bottom: 16px; }
    .agent-select select { padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; }
  </style>
</head>
<body>
  <div class="app">
    <div class="sidebar" id="sidebar">
      <h1><span>&#x1F996;</span> Lulzasaur</h1>
      <div class="nav-section">System</div>
      <a class="nav-item" onclick="showPage('inbox')" id="nav-inbox">Inbox <span id="inbox-badge" class="inbox-badge" style="display:none">0</span></a>
      <a class="nav-item active" onclick="showPage('chat')" id="nav-chat">Chat</a>
      <a class="nav-item" onclick="showPage('agents')" id="nav-agents">Agents</a>
      <a class="nav-item" onclick="showPage('tasks')" id="nav-tasks">Tasks</a>
      <a class="nav-item" onclick="showPage('bulletin')" id="nav-bulletin">Bulletin</a>
      <a class="nav-item" onclick="showPage('activity')" id="nav-activity">Activity</a>
      <a class="nav-item" onclick="showPage('tokens')" id="nav-tokens">Tokens</a>
      <div class="nav-section" id="projects-section" style="display:none">Projects</div>
      <div id="projects-tree"></div>
    </div>
    <div class="main">
      <div class="header" id="page-header">Chat</div>
      <div class="content" id="page-content"></div>
    </div>
  </div>

  <script>
    const API = '';
    let currentAgent = null;
    let agents = [];
    let projectsCache = [];

    async function api(path, opts) {
      const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
      return res.json();
    }

    // ── Sidebar & Projects Tree ──
    async function loadProjectsTree() {
      projectsCache = await api('/api/projects');
      const section = document.getElementById('projects-section');
      const tree = document.getElementById('projects-tree');
      if (projectsCache.length === 0) { section.style.display = 'none'; tree.innerHTML = ''; return; }
      section.style.display = '';

      tree.innerHTML = projectsCache.map(p =>
        '<div class="tree-node">' +
          '<div class="tree-toggle" onclick="toggleProjectTree(this, \\'' + p.id + '\\')">' +
            '<span class="arrow">&#9654;</span>' +
            '<span class="project-badge' + (p.active ? '' : ' inactive') + '"></span>' +
            escHtml(p.displayName) +
          '</div>' +
          '<div class="tree-children" id="ptree-' + p.id + '">' +
            '<a class="tree-leaf" onclick="showProjectAgents(\\'' + p.id + '\\', \\'' + escAttr(p.displayName) + '\\')">Agents</a>' +
            '<a class="tree-leaf" onclick="showProjectEpics(\\'' + p.id + '\\', \\'' + escAttr(p.displayName) + '\\')">Epics</a>' +
            '<a class="tree-leaf" onclick="showProjectBulletin(\\'' + p.id + '\\', \\'' + escAttr(p.displayName) + '\\')">Bulletin</a>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function toggleProjectTree(el, projectId) {
      const children = document.getElementById('ptree-' + projectId);
      const arrow = el.querySelector('.arrow');
      if (children.classList.contains('open')) {
        children.classList.remove('open');
        arrow.classList.remove('open');
      } else {
        children.classList.add('open');
        arrow.classList.add('open');
      }
    }

    function clearActiveNav() {
      document.querySelectorAll('.nav-item, .tree-leaf').forEach(n => n.classList.remove('active'));
    }

    function showPage(page) {
      clearActiveNav();
      document.getElementById('nav-' + page)?.classList.add('active');
      const header = document.getElementById('page-header');
      const content = document.getElementById('page-content');
      currentPage = page;
      currentProjectFilter = null;
      header.textContent = { inbox: 'Inbox', chat: 'Chat', agents: 'Agents', tasks: 'Tasks', bulletin: 'Bulletin Board', activity: 'Activity', tokens: 'Token Usage' }[page];
      ({ inbox: renderInbox, chat: renderChat, agents: renderAgents, tasks: renderTasks, bulletin: renderBulletin, activity: renderActivity, tokens: renderTokensPage })[page](content);
    }

    // ── Project-filtered views ──
    let currentProjectFilter = null;

    async function showProjectAgents(projectId, projectName) {
      clearActiveNav();
      currentPage = 'project-agents';
      currentProjectFilter = projectId;
      document.getElementById('page-header').textContent = projectName + ' — Agents';
      const el = document.getElementById('page-content');
      const rows = await api('/api/projects/' + projectId + '/agents');
      const agentList = rows.map(a => a.agent || a);
      el.innerHTML = (agentList.length === 0 ? '<div class="loading">No agents in this project.</div>' :
        '<table><thead><tr><th>Name</th><th>Status</th><th>Depth</th><th>Model</th><th>Created</th></tr></thead><tbody>' +
        agentList.map(a => '<tr class="clickable" onclick="showAgentDetail(\\'' + a.id + '\\')">' +
          '<td><strong>' + escHtml(a.name) + '</strong><br><span style="color:var(--text-muted);font-size:11px">' + a.id.substring(0, 8) + '</span></td>' +
          '<td><span class="badge ' + a.status + '">' + a.status + '</span></td>' +
          '<td>' + a.depth + '</td><td>' + (a.model || '—') + '</td>' +
          '<td>' + new Date(a.createdAt).toLocaleString() + '</td></tr>'
        ).join('') +
        '</tbody></table>');
    }

    async function showProjectEpics(projectId, projectName) {
      clearActiveNav();
      currentPage = 'project-epics';
      currentProjectFilter = projectId;
      document.getElementById('page-header').textContent = projectName + ' — Epics';
      const el = document.getElementById('page-content');
      const epics = await api('/api/projects/' + projectId + '/epics');

      if (epics.length === 0) {
        el.innerHTML = '<div class="loading">No epics in this project yet.</div>';
        return;
      }

      el.innerHTML = epics.map(epic =>
        '<div class="epic-card">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span class="badge epic">epic</span>' +
            '<span class="badge ' + epic.status + '">' + epic.status.replace(/_/g, ' ') + '</span>' +
          '</div>' +
          '<div class="epic-title">' + escHtml(epic.title) + '</div>' +
          '<div class="epic-desc">' + escHtml((epic.description || '').substring(0, 200)) + '</div>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + epic.progress + '%"></div></div>' +
          '<div class="progress-text">' + epic.progress + '% complete (' +
            epic.children.filter(c => c.status === 'completed').length + '/' + epic.children.length + ' tasks)</div>' +
          (epic.children.length > 0 ?
            '<div class="child-tasks">' +
            epic.children.map(c =>
              '<div class="child-task" onclick="openTaskModal(\\'' + c.id + '\\')">' +
                '<span class="badge ' + c.status + '" style="font-size:10px">' + c.status.replace(/_/g, ' ') + '</span>' +
                '<span>' + escHtml(c.title) + '</span>' +
              '</div>'
            ).join('') +
            '</div>' : '') +
        '</div>'
      ).join('');

      // Cache these tasks for modal opening
      allTasksCache = [];
      for (const epic of epics) {
        allTasksCache.push(epic);
        allTasksCache.push(...epic.children);
      }
    }

    async function showProjectBulletin(projectId, projectName) {
      clearActiveNav();
      currentPage = 'project-bulletin';
      currentProjectFilter = projectId;
      document.getElementById('page-header').textContent = projectName + ' — Bulletin';
      const el = document.getElementById('page-content');
      const posts = await api('/api/bulletin?projectId=' + projectId);

      el.innerHTML =
        (posts.length === 0 ? '<div class="loading">No bulletin posts for this project yet.</div>' :
        posts.map(p => renderBulletinPost(p)).join(''));
    }

    // ── Inbox ──
    async function updateInboxBadge() {
      try {
        const data = await api('/api/inbox/count');
        const badge = document.getElementById('inbox-badge');
        if (badge) {
          if (data.pending > 0) {
            badge.textContent = String(data.pending);
            badge.style.display = '';
          } else {
            badge.style.display = 'none';
          }
        }
      } catch (e) { /* silent */ }
    }

    let inboxFilter = 'pending';

    async function renderInbox(el) {
      const items = await api('/api/inbox?status=' + inboxFilter);
      const filters = ['pending', 'approved', 'rejected', 'dismissed', 'replied'];
      const filterLabels = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', dismissed: 'Dismissed', replied: 'Replied' };

      el.innerHTML =
        '<div class="bulletin-filters">' +
        filters.map(f =>
          '<button class="' + (f === inboxFilter ? 'active' : '') + '" onclick="filterInbox(\\'' + f + '\\')">' + filterLabels[f] + '</button>'
        ).join('') +
        '</div>' +
        (items.length === 0 ? '<div class="loading">No inbox items.</div>' :
        items.map(item => {
          const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
          const time = new Date(item.createdAt).toLocaleString();
          const idPrefix = item.id.substring(0, 8);
          let actions = '';

          if (item.status === 'pending') {
            if (item.type === 'review') {
              actions =
                '<button class="btn-success" onclick="inboxRespond(\\'' + item.id + '\\', \\'approve\\')">Approve</button>' +
                '<button class="btn-danger" onclick="inboxReject(\\'' + item.id + '\\')">Reject</button>';
            } else if (item.type === 'proposal') {
              actions =
                '<button class="btn-success" onclick="inboxRespond(\\'' + item.id + '\\', \\'approve\\')">Approve</button>' +
                '<input class="btn-reply-input" id="reply-' + idPrefix + '" placeholder="Reply..." />' +
                '<button class="btn-primary" onclick="inboxReplyFromInput(\\'' + item.id + '\\', \\'' + idPrefix + '\\')">Reply</button>' +
                '<button class="btn-ghost" onclick="inboxRespond(\\'' + item.id + '\\', \\'dismiss\\')">Dismiss</button>';
            } else if (item.type === 'question') {
              actions =
                '<input class="btn-reply-input" id="reply-' + idPrefix + '" placeholder="Your answer..." />' +
                '<button class="btn-primary" onclick="inboxReplyFromInput(\\'' + item.id + '\\', \\'' + idPrefix + '\\')">Reply</button>' +
                '<button class="btn-ghost" onclick="inboxRespond(\\'' + item.id + '\\', \\'dismiss\\')">Dismiss</button>';
            } else {
              // update and alert types — show reply + dismiss
              actions =
                '<input class="btn-reply-input" id="reply-' + idPrefix + '" placeholder="Reply..." />' +
                '<button class="btn-primary" onclick="inboxReplyFromInput(\\'' + item.id + '\\', \\'' + idPrefix + '\\')">Reply</button>' +
                '<button class="btn-ghost" onclick="inboxRespond(\\'' + item.id + '\\', \\'dismiss\\')">Dismiss</button>';
            }
          }

          return '<div class="inbox-card ' + item.type + '">' +
            '<div class="inbox-header">' +
              '<span class="badge ' + item.type + '">' + typeLabel + '</span>' +
              '<span style="font-size:12px;color:var(--text-muted)">' + escHtml(item.agentName) + '</span>' +
              '<span style="font-size:11px;color:var(--text-muted);margin-left:auto">' + idPrefix + '</span>' +
            '</div>' +
            '<div class="inbox-title">' + escHtml(item.title) + '</div>' +
            '<div class="inbox-body">' + escHtml(item.body) + '</div>' +
            '<div class="inbox-meta">' + time +
              (item.userResponse ? ' &middot; Response: ' + escHtml(item.userResponse) : '') +
            '</div>' +
            (actions ? '<div class="inbox-actions">' + actions + '</div>' : '') +
          '</div>';
        }).join(''));

      updateInboxBadge();
    }

    function filterInbox(status) {
      inboxFilter = status;
      renderInbox(document.getElementById('page-content'));
    }

    async function inboxRespond(itemId, action, message) {
      await api('/api/inbox/' + itemId + '/respond', {
        method: 'POST', body: JSON.stringify({ action, message: message || undefined })
      });
      renderInbox(document.getElementById('page-content'));
    }

    async function inboxReject(itemId) {
      const feedback = prompt('Rejection feedback (optional):');
      await inboxRespond(itemId, 'reject', feedback || 'Rejected by user.');
    }

    async function inboxReplyFromInput(itemId, idPrefix) {
      const input = document.getElementById('reply-' + idPrefix);
      const msg = input ? input.value.trim() : '';
      if (!msg) { alert('Please enter a reply message.'); return; }
      await inboxRespond(itemId, 'reply', msg);
    }

    // ── Chat ──
    let chatMessages = [];

    async function renderChat(el) {
      if (!agents.length) agents = await api('/api/agents');
      const agentList = agents.map(a => a.agent || a);

      if (!currentAgent && agentList.length) currentAgent = agentList[0].id;

      el.innerHTML = '<div class="chat-container">' +
        '<div class="agent-select"><select id="agent-sel">' +
        agentList.map(a => '<option value="' + a.id + '"' + (a.id === currentAgent ? ' selected' : '') + '>' + a.name + ' (' + a.status + ')</option>').join('') +
        '</select></div>' +
        '<div class="chat-messages" id="chat-msgs"></div>' +
        '<div class="chat-input"><input id="chat-in" placeholder="Type a message..." /><button id="chat-btn" onclick="sendChat()">Send</button></div>' +
        '</div>';

      document.getElementById('agent-sel').onchange = (e) => { currentAgent = e.target.value; loadConversationHistory(); };
      document.getElementById('chat-in').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
      loadConversationHistory();
    }

    function renderChatMsgs() {
      const el = document.getElementById('chat-msgs');
      if (!el) return;
      el.innerHTML = chatMessages.map(m =>
        '<div class="chat-msg ' + m.role + '">' + escHtml(m.text) +
        (m.meta ? '<div class="meta">' + m.meta + '</div>' : '') + '</div>'
      ).join('') || '<div class="loading">Start a conversation...</div>';
      el.scrollTop = el.scrollHeight;
    }

    async function loadConversationHistory() {
      chatMessages = [];
      if (!currentAgent) { renderChatMsgs(); return; }
      try {
        const convos = await api('/api/agents/' + currentAgent + '/conversations');
        const active = convos.find(c => c.isActive) || convos[0];
        if (active && active.messages) {
          for (const m of active.messages) {
            if (m.role === 'user' && typeof m.content === 'string') {
              chatMessages.push({ role: 'user', text: m.content });
            } else if (m.role === 'assistant') {
              let text = '';
              if (typeof m.content === 'string') {
                text = m.content;
              } else if (Array.isArray(m.content)) {
                text = m.content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\\n');
              }
              if (text) chatMessages.push({ role: 'assistant', text });
            }
          }
        }
      } catch (e) { console.warn('Failed to load history:', e); }
      renderChatMsgs();
    }

    async function sendChat() {
      const input = document.getElementById('chat-in');
      const btn = document.getElementById('chat-btn');
      const text = input.value.trim();
      if (!text || !currentAgent) return;

      chatMessages.push({ role: 'user', text });
      input.value = '';
      btn.disabled = true;
      renderChatMsgs();

      try {
        const res = await api('/api/agents/' + currentAgent + '/message', {
          method: 'POST', body: JSON.stringify({ text })
        });
        chatMessages.push({ role: 'assistant', text: res.response, meta: res.toolCalls + ' tools, ' + res.tokens + ' tokens, ' + res.durationMs + 'ms' });
      } catch (e) {
        chatMessages.push({ role: 'assistant', text: 'Error: ' + e.message });
      }
      btn.disabled = false;
      renderChatMsgs();
      input.focus();
    }

    // ── Agents ──
    let showTerminated = false;

    async function renderAgents(el) {
      const url = '/api/agents' + (showTerminated ? '?include_terminated=true' : '');
      agents = await api(url);
      const agentList = agents.map(a => a.agent || a);

      // Group by project
      const globalAgents = agentList.filter(a => !a.projectId);
      const projectGroups = {};
      for (const a of agentList) {
        if (a.projectId) {
          if (!projectGroups[a.projectId]) projectGroups[a.projectId] = [];
          projectGroups[a.projectId].push(a);
        }
      }

      function renderAgentTable(list) {
        return '<table><thead><tr><th>Name</th><th>Status</th><th>Model</th><th>Heartbeat</th><th>Created</th></tr></thead><tbody>' +
          list.map(a => {
            const hb = a.heartbeatIntervalSeconds ? formatInterval(a.heartbeatIntervalSeconds) : '—';
            return '<tr class="clickable" onclick="showAgentDetail(\\'' + a.id + '\\')">' +
              '<td><strong>' + escHtml(a.name) + '</strong></td>' +
              '<td><span class="badge ' + a.status + '">' + a.status + '</span></td>' +
              '<td>' + (a.model || '—') + '</td>' +
              '<td>' + hb + '</td>' +
              '<td>' + new Date(a.createdAt).toLocaleString() + '</td></tr>';
          }).join('') +
          '</tbody></table>';
      }

      let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
          '<label style="font-size:13px;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;gap:6px">' +
            '<input type="checkbox" id="show-terminated" ' + (showTerminated ? 'checked' : '') + ' onchange="toggleTerminated(this.checked)" />' +
            'Show terminated agents' +
          '</label>' +
          '<span style="font-size:12px;color:var(--text-muted)">(' + agentList.length + ' agents)</span>' +
        '</div>';

      // Global agents
      if (globalAgents.length > 0) {
        html += '<h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-muted)">Core Agents</h3>';
        html += renderAgentTable(globalAgents);
      }

      // Project agents
      for (const [projectId, list] of Object.entries(projectGroups)) {
        const proj = projectsCache.find(p => p.id === projectId);
        const projName = proj ? proj.displayName : projectId.substring(0, 8);
        html += '<h3 style="margin:24px 0 8px;font-size:14px;color:var(--text-muted)">' + escHtml(projName) + '</h3>';
        html += renderAgentTable(list);
      }

      el.innerHTML = html;
    }

    function toggleTerminated(checked) {
      showTerminated = checked;
      renderAgents(document.getElementById('page-content'));
    }

    // ── Agent Detail View ──
    let detailAgentId = null;
    let ccTerminalLines = [];
    let ccSessionActive = false;

    async function showAgentDetail(agentId) {
      clearActiveNav();
      currentPage = 'agent-detail';
      detailAgentId = agentId;
      ccTerminalLines = [];
      ccSessionActive = false;

      const header = document.getElementById('page-header');
      const el = document.getElementById('page-content');

      // Fetch agent data
      const agent = await api('/api/agents/' + agentId);
      const proj = agent.projectId ? projectsCache.find(p => p.id === agent.projectId) : null;

      header.textContent = agent.name;

      el.innerHTML =
        '<div class="agent-detail-back" onclick="showPage(\\'agents\\')">&larr; Back to Agents</div>' +
        '<div class="agent-detail-header">' +
          '<h2>' + escHtml(agent.name) + '</h2>' +
          '<span class="badge ' + agent.status + '">' + agent.status + '</span>' +
        '</div>' +
        '<div class="agent-detail-meta">' +
          '<div class="meta-item"><span class="meta-label">ID</span> ' + agent.id.substring(0, 12) + '</div>' +
          '<div class="meta-item"><span class="meta-label">Model</span> ' + (agent.model || 'default') + '</div>' +
          '<div class="meta-item"><span class="meta-label">Depth</span> ' + agent.depth + '</div>' +
          '<div class="meta-item"><span class="meta-label">Project</span> ' + (proj ? escHtml(proj.displayName) : 'global') + '</div>' +
          '<div class="meta-item"><span class="meta-label">Created</span> ' + new Date(agent.createdAt).toLocaleString() + '</div>' +
        '</div>' +
        '<div class="detail-tabs">' +
          '<div class="detail-tab active" onclick="switchDetailTab(this, \\'tab-cc\\')">Claude Code</div>' +
          '<div class="detail-tab" onclick="switchDetailTab(this, \\'tab-convos\\')">Conversations</div>' +
          '<div class="detail-tab" onclick="switchDetailTab(this, \\'tab-heartbeats\\')">Heartbeats</div>' +
        '</div>' +
        '<div id="tab-cc" class="detail-tab-content active"></div>' +
        '<div id="tab-convos" class="detail-tab-content"></div>' +
        '<div id="tab-heartbeats" class="detail-tab-content"></div>';

      renderCCTab(agentId);
      renderConvosTab(agentId);
      renderHeartbeatsTab(agentId);
      ensureSSE();
    }

    function switchDetailTab(tabEl, tabId) {
      tabEl.parentElement.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      tabEl.classList.add('active');
      tabEl.closest('.content').querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    }

    // ── Claude Code Tab ──
    async function renderCCTab(agentId) {
      const tab = document.getElementById('tab-cc');
      if (!tab) return;

      // Fetch last known status from agent_memory
      let statusText = 'No active session';
      let dotClass = 'idle';
      try {
        const res = await api('/api/agents/' + agentId + '/claude-code-status');
        if (res.status) {
          const s = typeof res.status === 'string' ? res.status : JSON.stringify(res.status);
          statusText = s;
          if (s.startsWith('running')) { dotClass = 'running'; ccSessionActive = true; }
          else if (s.startsWith('error') || s.startsWith('timed_out')) { dotClass = 'error'; }
        }
      } catch (e) { /* no status yet */ }

      tab.innerHTML =
        '<div class="cc-terminal">' +
          '<div class="cc-terminal-header">' +
            '<div class="cc-status"><span class="cc-dot ' + dotClass + '" id="cc-dot"></span><span id="cc-status-text">' + escHtml(statusText) + '</span></div>' +
            '<div class="cc-terminal-actions">' +
              '<button onclick="clearCCTerminal()">Clear</button>' +
              '<button onclick="scrollCCBottom()">Scroll to bottom</button>' +
            '</div>' +
          '</div>' +
          '<div class="cc-terminal-body" id="cc-terminal-body">' +
            '<div class="cc-empty">Waiting for Claude Code output...</div>' +
          '</div>' +
        '</div>';
    }

    function appendCCLine(event) {
      const body = document.getElementById('cc-terminal-body');
      if (!body) return;

      // Remove empty placeholder
      const empty = body.querySelector('.cc-empty');
      if (empty) empty.remove();

      const time = new Date(event.timestamp).toLocaleTimeString();
      const lineEl = document.createElement('div');
      lineEl.className = 'cc-line ' + event.type;
      lineEl.innerHTML = '<span class="cc-time">' + time + '</span>' + escHtml(event.text);
      body.appendChild(lineEl);

      // Keep max 500 lines
      while (body.children.length > 500) body.removeChild(body.firstChild);

      // Auto-scroll if near bottom
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 100) {
        body.scrollTop = body.scrollHeight;
      }

      // Update status dot
      const dot = document.getElementById('cc-dot');
      const statusText = document.getElementById('cc-status-text');
      if (dot && statusText) {
        if (event.type === 'start') {
          dot.className = 'cc-dot running';
          statusText.textContent = 'Running: ' + event.text.substring(0, 80);
          ccSessionActive = true;
        } else if (event.type === 'complete') {
          dot.className = 'cc-dot idle';
          statusText.textContent = event.text;
          ccSessionActive = false;
        } else if (event.type === 'error') {
          dot.className = 'cc-dot error';
          statusText.textContent = event.text;
          ccSessionActive = false;
        }
      }
    }

    function clearCCTerminal() {
      const body = document.getElementById('cc-terminal-body');
      if (body) body.innerHTML = '<div class="cc-empty">Terminal cleared.</div>';
      ccTerminalLines = [];
    }

    function scrollCCBottom() {
      const body = document.getElementById('cc-terminal-body');
      if (body) body.scrollTop = body.scrollHeight;
    }

    // ── Conversations Tab ──
    async function renderConvosTab(agentId) {
      const tab = document.getElementById('tab-convos');
      if (!tab) return;
      try {
        const convos = await api('/api/agents/' + agentId + '/conversations');
        if (!convos.length) {
          tab.innerHTML = '<div class="cc-empty">No conversations yet.</div>';
          return;
        }
        tab.innerHTML = convos.map(c => {
          const msgCount = (c.messages || []).length;
          const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
          let preview = '';
          if (lastMsg) {
            if (typeof lastMsg.content === 'string') preview = lastMsg.content.substring(0, 120);
            else if (Array.isArray(lastMsg.content)) {
              const txt = lastMsg.content.find(b => b.type === 'text');
              if (txt && txt.text) preview = txt.text.substring(0, 120);
            }
          }
          return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
              '<strong style="font-size:13px">' + (c.isActive ? 'Active Conversation' : 'Conversation') + '</strong>' +
              '<span style="font-size:11px;color:var(--text-muted)">' + msgCount + ' messages &middot; ' + (c.tokenCount || 0) + ' tokens</span>' +
            '</div>' +
            (preview ? '<div style="font-size:12px;color:var(--text-muted)">' + escHtml(preview) + '...</div>' : '') +
          '</div>';
        }).join('');
      } catch (e) {
        tab.innerHTML = '<div class="cc-empty">Failed to load conversations.</div>';
      }
    }

    // ── Heartbeats Tab ──
    async function renderHeartbeatsTab(agentId) {
      const tab = document.getElementById('tab-heartbeats');
      if (!tab) return;
      try {
        const heartbeats = await api('/api/activity/heartbeats');
        const mine = heartbeats.filter(h => h.agentId === agentId);
        if (!mine.length) {
          tab.innerHTML = '<div class="cc-empty">No heartbeat history.</div>';
          return;
        }
        tab.innerHTML =
          '<table><thead><tr><th>Triggered</th><th>Duration</th><th>Status</th></tr></thead><tbody>' +
          mine.map(h =>
            '<tr><td>' + new Date(h.triggeredAt).toLocaleString() + '</td>' +
            '<td>' + (h.durationMs ? h.durationMs + 'ms' : '—') + '</td>' +
            '<td>' + (h.error ? '<span style="color:var(--red)">' + escHtml(h.error.substring(0, 80)) + '</span>' : '<span style="color:var(--green)">OK</span>') + '</td></tr>'
          ).join('') +
          '</tbody></table>';
      } catch (e) {
        tab.innerHTML = '<div class="cc-empty">Failed to load heartbeats.</div>';
      }
    }

    // ── SSE Setup (initialize once, forward Claude Code events) ──
    function ensureSSE() {
      if (window._sse) return;
      window._sse = new EventSource('/api/activity/stream');

      window._sse.addEventListener('agent_update', (e) => {
        const data = JSON.parse(e.data);
        console.log('Agent update:', data);
      });
      window._sse.addEventListener('task_update', (e) => {
        const data = JSON.parse(e.data);
        console.log('Task update:', data);
      });
      window._sse.addEventListener('inbox_count', (e) => {
        const data = JSON.parse(e.data);
        const badge = document.getElementById('inbox-badge');
        if (badge) {
          if (data.pending > 0) { badge.textContent = String(data.pending); badge.style.display = ''; }
          else { badge.style.display = 'none'; }
        }
      });
      window._sse.addEventListener('inbox_item', (e) => {
        const data = JSON.parse(e.data);
        console.log('New inbox item:', data);
      });

      // Claude Code streaming — forward to terminal if viewing the right agent
      window._sse.addEventListener('claude_code_output', (e) => {
        const event = JSON.parse(e.data);
        if (currentPage === 'agent-detail' && event.agentId === detailAgentId) {
          appendCCLine(event);
        }
      });
    }

    // ── Tasks (Kanban) ──
    let allTasksCache = [];

    async function renderTasks(el) {
      allTasksCache = await api('/api/tasks');
      if (!agents.length) agents = await api('/api/agents');
      const cols = { pending: [], assigned: [], in_progress: [], review_pending: [], completed: [], failed: [] };
      for (const t of allTasksCache) {
        if (cols[t.status]) cols[t.status].push(t);
      }
      const collapsedStatuses = ['completed', 'failed'];
      el.innerHTML = '<div class="kanban">' +
        Object.entries(cols).map(([status, items]) => {
          const isCollapsed = collapsedStatuses.includes(status) && items.length > 0;
          return '<div class="kanban-col' + (isCollapsed ? ' collapsed' : '') + '">' +
          '<h3 onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')"><span class="toggle-arrow">&#9660;</span>' + status.replace(/_/g, ' ') + ' (' + items.length + ')</h3>' +
          items.map(t =>
            '<div class="kanban-card" onclick="openTaskModal(\\'' + t.id + '\\')">' +
            '<div style="display:flex;gap:4px;margin-bottom:4px">' +
              '<span class="badge ' + t.type + '">' + t.type + '</span>' +
            '</div>' +
            '<div class="title">' + escHtml(t.title) + '</div>' +
            '<div class="desc">' + escHtml((t.description || '').substring(0, 100)) + '</div>' +
            (t.priority > 0 ? '<div class="priority">Priority: ' + t.priority + '</div>' : '') +
            '<div style="margin-top:6px"><span class="badge ' + t.verificationStatus + '">' + t.verificationStatus + '</span></div>' +
            '</div>'
          ).join('') +
          '</div>';
        }).join('') +
        '</div>';
    }

    function openTaskModal(taskId) {
      const t = allTasksCache.find(x => x.id === taskId);
      if (!t) return;
      const agentList = agents.map(a => a.agent || a);
      const statuses = ['pending', 'assigned', 'in_progress', 'review_pending', 'completed', 'failed', 'cancelled'];
      const isReview = t.status === 'review_pending';

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

      overlay.innerHTML =
        '<div class="modal">' +
        '<h2>Edit Task</h2>' +
        '<label>Title</label>' +
        '<input id="modal-title" value="' + escAttr(t.title) + '" />' +
        '<label>Description</label>' +
        '<textarea id="modal-desc">' + escHtml(t.description || '') + '</textarea>' +
        '<label>Status</label>' +
        '<select id="modal-status">' +
        statuses.map(s => '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>').join('') +
        '</select>' +
        '<label>Type</label>' +
        '<div style="font-size:13px;padding:4px 0"><span class="badge ' + (t.type || 'task') + '">' + (t.type || 'task') + '</span></div>' +
        '<label>Priority</label>' +
        '<input id="modal-priority" type="number" value="' + (t.priority || 0) + '" />' +
        '<label>Assigned To</label>' +
        '<select id="modal-assigned">' +
        '<option value="">Unassigned</option>' +
        agentList.map(a => '<option value="' + a.id + '"' + (a.id === t.assignedTo ? ' selected' : '') + '>' + escHtml(a.name) + '</option>').join('') +
        '</select>' +
        (t.result ? '<label>Result</label><pre style="font-size:12px;color:var(--text-muted);background:var(--bg);padding:8px;border-radius:6px;overflow-x:auto;max-height:120px">' + escHtml(JSON.stringify(t.result, null, 2)) + '</pre>' : '') +
        (t.verificationNotes ? '<label>Verification Notes</label><div style="font-size:12px;color:var(--text-muted);padding:4px 0">' + escHtml(t.verificationNotes) + '</div>' : '') +
        '<div class="modal-actions">' +
        (isReview ? '<button class="btn-success" onclick="approveTask(\\'' + t.id + '\\')">Approve</button><button class="btn-danger" onclick="rejectTask(\\'' + t.id + '\\')">Reject</button>' : '') +
        '<button class="btn-ghost" onclick="this.closest(\\'.modal-overlay\\').remove()">Cancel</button>' +
        '<button class="btn-primary" onclick="saveTask(\\'' + t.id + '\\')">Save</button>' +
        '</div></div>';

      document.body.appendChild(overlay);
    }

    async function saveTask(taskId) {
      const updates = {
        title: document.getElementById('modal-title').value,
        description: document.getElementById('modal-desc').value,
        status: document.getElementById('modal-status').value,
        priority: parseInt(document.getElementById('modal-priority').value) || 0,
        assignedTo: document.getElementById('modal-assigned').value || null,
      };
      await api('/api/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify(updates) });
      document.querySelector('.modal-overlay')?.remove();
      renderTasks(document.getElementById('page-content'));
    }

    async function approveTask(taskId) {
      await api('/api/tasks/' + taskId + '/approve', { method: 'POST', body: '{}' });
      document.querySelector('.modal-overlay')?.remove();
      renderTasks(document.getElementById('page-content'));
    }

    async function rejectTask(taskId) {
      const feedback = prompt('Rejection feedback (optional):');
      await api('/api/tasks/' + taskId + '/reject', { method: 'POST', body: JSON.stringify({ feedback: feedback || 'Rejected by user.' }) });
      document.querySelector('.modal-overlay')?.remove();
      renderTasks(document.getElementById('page-content'));
    }

    function escAttr(s) {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Bulletin Board ──
    let bulletinChannel = '';

    async function renderBulletin(el) {
      const url = '/api/bulletin' + (bulletinChannel ? '?channel=' + bulletinChannel : '');
      const posts = await api(url);
      const channels = ['', 'general', 'help-wanted', 'discoveries', 'status-updates'];
      const channelLabels = { '': 'All', 'general': 'General', 'help-wanted': 'Help Wanted', 'discoveries': 'Discoveries', 'status-updates': 'Status Updates' };

      el.innerHTML =
        '<div class="bulletin-filters">' +
        channels.map(ch =>
          '<button class="' + (ch === bulletinChannel ? 'active' : '') + '" onclick="filterBulletin(\\'' + ch + '\\')">' + channelLabels[ch] + '</button>'
        ).join('') +
        '</div>' +
        (posts.length === 0 ? '<div class="loading">No bulletin posts yet.</div>' :
        posts.map(p => renderBulletinPost(p)).join(''));
    }

    function renderBulletinPost(p) {
      const timeAgo = formatTimeAgo(new Date(p.createdAt));
      const tags = (p.tags && p.tags.length) ? '<div class="post-tags">' + p.tags.map(t => '<span class="tag">' + escHtml(t) + '</span>').join('') + '</div>' : '';
      return '<div class="bulletin-post' + (p.pinned ? ' pinned' : '') + '">' +
        '<div class="bulletin-row" onclick="toggleBulletinPost(this)">' +
          (p.pinned ? '<span class="pin-icon">&#x1F4CC;</span>' : '') +
          '<span class="post-channel">' + escHtml(p.channel) + '</span>' +
          '<span class="post-title">' + escHtml(p.title) + '</span>' +
          tags +
          '<span class="post-author">' + escHtml(p.author) + '</span>' +
          '<span class="post-time">' + timeAgo + '</span>' +
        '</div>' +
        '<div class="bulletin-expand">' +
          '<div class="post-body">' + escHtml(p.body) + '</div>' +
        '</div>' +
      '</div>';
    }

    function toggleBulletinPost(rowEl) {
      const expand = rowEl.nextElementSibling;
      if (expand) expand.classList.toggle('open');
    }
    window.toggleBulletinPost = toggleBulletinPost;

    function formatTimeAgo(date) {
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      return days + 'd ago';
    }

    function formatTimeUntil(date) {
      const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
      if (seconds <= 0) return 'overdue';
      if (seconds < 60) return 'in ' + seconds + 's';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return 'in ' + minutes + 'm';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return 'in ' + hours + 'h';
      const days = Math.floor(hours / 24);
      return 'in ' + days + 'd';
    }

    function filterBulletin(ch) {
      bulletinChannel = ch;
      renderBulletin(document.getElementById('page-content'));
    }

    // ── Activity ──
    let activityTab = 'schedule';

    async function renderActivity(el) {
      el.innerHTML =
        '<div class="schedule-tabs">' +
          '<button class="' + (activityTab === 'schedule' ? 'active' : '') + '" onclick="switchActivityTab(\\\'schedule\\\')">Schedule</button>' +
          '<button class="' + (activityTab === 'heartbeats' ? 'active' : '') + '" onclick="switchActivityTab(\\\'heartbeats\\\')">Heartbeat Log</button>' +
          '<button class="' + (activityTab === 'tokens' ? 'active' : '') + '" onclick="switchActivityTab(\\\'tokens\\\')">Token Usage</button>' +
        '</div>' +
        '<div id="activity-tab-content"></div>';

      if (activityTab === 'schedule') {
        await renderScheduleHeatmap(document.getElementById('activity-tab-content'));
      } else if (activityTab === 'tokens') {
        await renderTokenUsage(document.getElementById('activity-tab-content'));
      } else {
        await renderHeartbeatLog(document.getElementById('activity-tab-content'));
      }
      ensureSSE();
    }

    function switchActivityTab(tab) {
      activityTab = tab;
      renderActivity(document.getElementById('page-content'));
    }
    window.switchActivityTab = switchActivityTab;

    async function renderHeartbeatLog(el) {
      const heartbeats = await api('/api/activity/heartbeats');
      el.innerHTML =
        '<table><thead><tr><th>Agent</th><th>Triggered</th><th>Duration</th><th>Summary</th><th>Status</th></tr></thead><tbody>' +
        heartbeats.map(h => {
          const name = h.agentName || h.agentId.substring(0, 8);
          const summary = h.result?.response ? escHtml(h.result.response.substring(0, 120)) + (h.result.response.length > 120 ? '...' : '') : '—';
          const toolCount = h.result?.toolCalls ? ' <span style="color:var(--text-muted)">(' + h.result.toolCalls + ' tools)</span>' : '';
          return '<tr><td><strong>' + escHtml(name) + '</strong></td>' +
          '<td>' + new Date(h.triggeredAt).toLocaleString() + '</td>' +
          '<td>' + (h.durationMs ? (h.durationMs / 1000).toFixed(1) + 's' : '—') + '</td>' +
          '<td style="max-width:400px;font-size:12px">' + summary + toolCount + '</td>' +
          '<td>' + (h.error ? '<span style="color:var(--red)">' + escHtml(h.error.substring(0, 60)) + '</span>' : '<span style="color:var(--green)">OK</span>') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
    }

    async function renderScheduleHeatmap(el) {
      const data = await api('/api/activity/schedule');
      if (!data.agents || data.agents.length === 0) {
        el.innerHTML = '<div class="loading">No agents with heartbeat schedules.</div>';
        return;
      }

      // Group agents: core (no project) vs project agents
      const coreAgents = data.agents.filter(a => !a.projectId);
      const projectGroups = {};
      for (const a of data.agents) {
        if (a.projectId) {
          if (!projectGroups[a.projectId]) projectGroups[a.projectId] = [];
          projectGroups[a.projectId].push(a);
        }
      }

      let html = '';

      function renderHeatmapSection(title, agentList) {
        if (agentList.length === 0) return '';
        let s = '<h3 style="margin:20px 0 8px;font-size:14px;color:var(--text-muted)">' + escHtml(title) + '</h3>';

        // Summary chips
        s += '<div class="schedule-agent-summary">';
        for (const a of agentList) {
          const nextBeat = a.nextHeartbeatAt ? formatTimeUntil(new Date(a.nextHeartbeatAt)) : 'none';
          const defaultInt = a.defaultInterval ? formatInterval(a.defaultInterval) : 'none';
          s += '<div class="schedule-agent-chip">' +
            '<span class="dot ' + a.status + '"></span>' +
            '<strong>' + escHtml(a.agentName) + '</strong>' +
            '<span class="interval">' + defaultInt + '</span>' +
            '<span class="interval">next: ' + nextBeat + '</span>' +
          '</div>';
        }
        s += '</div>';

        // Heatmap table
        s += '<div class="schedule-heatmap"><table>';
        s += '<thead><tr><th></th>';
        for (const d of data.dayHeaders) {
          s += '<th colspan="24" class="day-header' + (d.isToday ? ' today' : '') + '">' + d.dayLabel + ' ' + d.date.substring(5) + '</th>';
        }
        s += '</tr><tr><th></th>';
        for (let d = 0; d < 7; d++) {
          for (let h = 0; h < 24; h++) {
            s += '<th>' + (h % 6 === 0 ? h : '') + '</th>';
          }
        }
        s += '</tr></thead><tbody>';

        for (const a of agentList) {
          s += '<tr><td class="agent-name">' + escHtml(a.agentName) + '</td>';
          for (const slot of a.hourly) {
            const heatLevel = wakeupsToHeatLevel(slot.wakeupsPerHour);
            const tooltip = a.agentName + ' — ' + data.dayHeaders[slot.day].dayLabel + ' ' + String(slot.hour).padStart(2, '0') + ':00\\n' +
              'Interval: ' + formatInterval(slot.intervalSeconds) + '\\n' +
              'Wakeups/hr: ' + slot.wakeupsPerHour +
              (slot.scheduleName ? '\\nSchedule: ' + slot.scheduleName : '');
            s += '<td class="heat-cell"><span class="cell heat-' + heatLevel + '" title="' + tooltip + '"></span></td>';
          }
          s += '</tr>';
        }
        s += '</tbody></table></div>';
        return s;
      }

      // Render core agents
      html += renderHeatmapSection('Core Agents', coreAgents);

      // Render project groups
      for (const [projectId, list] of Object.entries(projectGroups)) {
        const proj = projectsCache.find(p => p.id === projectId);
        const projName = proj ? proj.displayName : projectId.substring(0, 8);
        html += renderHeatmapSection(projName, list);
      }

      // Legend
      html += '<div class="schedule-legend">' +
        '<span>Less</span>' +
        '<span class="swatch heat-0"></span>' +
        '<span class="swatch heat-1"></span>' +
        '<span class="swatch heat-2"></span>' +
        '<span class="swatch heat-3"></span>' +
        '<span class="swatch heat-4"></span>' +
        '<span class="swatch heat-5"></span>' +
        '<span>More</span>' +
        '<span style="margin-left:16px">Hover cells for details</span>' +
      '</div>';

      el.innerHTML = html;
    }

    let tokenHours = 24;
    async function renderTokenUsage(el) {
      const data = await api('/api/activity/tokens/summary?hours=' + tokenHours);
      if (!data || !data.byAgent) {
        el.innerHTML = '<div class="loading">No token usage data yet. Data is recorded after agent turns complete.</div>';
        return;
      }

      let html = '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:12px;color:var(--text-muted)">Period:</span>' +
        '<select id="token-period-select" onchange="changeTokenPeriod(this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px">' +
          '<option value="1"' + (tokenHours === 1 ? ' selected' : '') + '>1 hour</option>' +
          '<option value="6"' + (tokenHours === 6 ? ' selected' : '') + '>6 hours</option>' +
          '<option value="24"' + (tokenHours === 24 ? ' selected' : '') + '>24 hours</option>' +
          '<option value="168"' + (tokenHours === 168 ? ' selected' : '') + '>7 days</option>' +
        '</select>' +
      '</div>';

      // Totals card
      const t = data.totals;
      html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">' +
        tokenCard('API Calls', t.calls) +
        tokenCard('Input Tokens', formatTokenCount(t.totalInput)) +
        tokenCard('Output Tokens', formatTokenCount(t.totalOutput)) +
        tokenCard('Total Tokens', formatTokenCount(t.totalTokens)) +
        tokenCard('Est. Cost', '$' + (t.estimatedCostUSD ?? 0).toFixed(2)) +
      '</div>';

      // Hourly bar chart
      const hourly = await api('/api/activity/tokens/hourly?hours=' + tokenHours);
      if (hourly && hourly.length > 0) {
        const maxTokens = Math.max(...hourly.map(h => h.totalTokens), 1);
        html += '<div style="margin-bottom:24px">' +
          '<h3 style="font-size:14px;color:var(--text-muted);margin-bottom:8px">Usage Over Time</h3>' +
          '<div style="display:flex;align-items:flex-end;gap:2px;height:120px;padding:4px 0;border-bottom:1px solid var(--border)">';
        for (const h of hourly) {
          const pct = Math.max(2, Math.round((h.totalTokens / maxTokens) * 100));
          const label = h.hour.substring(11, 16) || h.hour.substring(5);
          const tooltip = label + '\\n' + formatTokenCount(h.totalTokens) + ' tokens\\n' + h.calls + ' calls';
          html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0">' +
            '<div title="' + tooltip + '" style="width:100%;max-width:32px;height:' + pct + '%;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;cursor:default"></div>' +
          '</div>';
        }
        html += '</div>';
        // X-axis labels (show every few)
        const step = Math.max(1, Math.floor(hourly.length / 12));
        html += '<div style="display:flex;gap:2px">';
        for (let i = 0; i < hourly.length; i++) {
          const label = (i % step === 0) ? (hourly[i].hour.substring(11, 16) || hourly[i].hour.substring(5)) : '';
          html += '<div style="flex:1;text-align:center;font-size:9px;color:var(--text-muted);min-width:0;overflow:hidden">' + label + '</div>';
        }
        html += '</div></div>';
      }

      // By-agent table
      html += '<h3 style="font-size:14px;color:var(--text-muted);margin-bottom:8px">By Agent</h3>';
      html += '<table><thead><tr>' +
        '<th>Agent</th><th>Model</th><th>Trigger</th><th>Calls</th>' +
        '<th>Input</th><th>Output</th><th>Total</th><th>Avg Duration</th><th>Est. Cost</th>' +
      '</tr></thead><tbody>';

      for (const r of data.byAgent) {
        const isHaiku = r.model.includes('haiku');
        const costEst = (r.totalInput * (isHaiku ? 0.80 : 3.0) + r.totalOutput * (isHaiku ? 4.0 : 15.0)) / 1000000;
        const barWidth = t.totalTokens > 0 ? Math.round((r.totalTokens / t.totalTokens) * 100) : 0;

        html += '<tr>' +
          '<td><strong>' + escHtml(r.agentName) + '</strong></td>' +
          '<td style="font-size:11px">' + escHtml(r.model.replace('claude-', '')) + '</td>' +
          '<td><span style="padding:2px 6px;border-radius:8px;font-size:10px;background:' + (r.trigger === 'heartbeat' ? 'var(--accent)' : 'var(--blue)') + ';color:#fff">' + r.trigger + '</span></td>' +
          '<td>' + r.calls + '</td>' +
          '<td>' + formatTokenCount(r.totalInput) + '</td>' +
          '<td>' + formatTokenCount(r.totalOutput) + '</td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<div style="width:60px;height:8px;background:var(--border);border-radius:4px;overflow:hidden">' +
                '<div style="width:' + barWidth + '%;height:100%;background:var(--accent);border-radius:4px"></div>' +
              '</div>' +
              formatTokenCount(r.totalTokens) +
            '</div>' +
          '</td>' +
          '<td>' + (r.avgDurationMs ? (r.avgDurationMs / 1000).toFixed(1) + 's' : '—') + '</td>' +
          '<td>$' + costEst.toFixed(3) + '</td>' +
        '</tr>';
      }

      html += '</tbody></table>';

      // Recent log
      html += '<h3 style="margin:24px 0 8px;font-size:14px;color:var(--text-muted)">Recent Calls</h3>';
      const recent = await api('/api/activity/tokens?hours=' + tokenHours);
      if (recent && recent.length > 0) {
        html += '<table style="font-size:12px"><thead><tr>' +
          '<th>Time</th><th>Agent</th><th>Model</th><th>Trigger</th><th>In</th><th>Out</th><th>Tools</th><th>Duration</th>' +
        '</tr></thead><tbody>';
        for (const r of recent.slice(0, 50)) {
          html += '<tr>' +
            '<td>' + new Date(r.createdAt).toLocaleTimeString() + '</td>' +
            '<td>' + escHtml(r.agentName) + '</td>' +
            '<td style="font-size:10px">' + escHtml(r.model.replace('claude-', '')) + '</td>' +
            '<td>' + r.trigger + '</td>' +
            '<td>' + formatTokenCount(r.inputTokens) + '</td>' +
            '<td>' + formatTokenCount(r.outputTokens) + '</td>' +
            '<td>' + r.toolCalls + '</td>' +
            '<td>' + (r.durationMs ? (r.durationMs / 1000).toFixed(1) + 's' : '—') + '</td>' +
          '</tr>';
        }
        html += '</tbody></table>';
        if (recent.length > 50) {
          html += '<div style="color:var(--text-muted);font-size:11px;margin-top:4px">Showing 50 of ' + recent.length + ' entries</div>';
        }
      } else {
        html += '<div class="loading">No token usage recorded in this period.</div>';
      }

      el.innerHTML = html;
    }

    async function renderTokensPage(el) {
      await renderTokenUsage(el);
    }

    function changeTokenPeriod(hours) {
      tokenHours = parseInt(hours);
      const target = currentPage === 'tokens'
        ? document.getElementById('page-content')
        : document.getElementById('activity-tab-content');
      if (target) renderTokenUsage(target);
    }
    window.changeTokenPeriod = changeTokenPeriod;

    function tokenCard(label, value) {
      return '<div style="padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;min-width:100px">' +
        '<div style="font-size:11px;color:var(--text-muted)">' + label + '</div>' +
        '<div style="font-size:18px;font-weight:600;margin-top:2px">' + value + '</div>' +
      '</div>';
    }

    function formatTokenCount(n) {
      if (n == null || isNaN(n)) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    function wakeupsToHeatLevel(wakeups) {
      if (wakeups <= 0) return 0;
      if (wakeups <= 1) return 1;
      if (wakeups <= 2) return 2;
      if (wakeups <= 4) return 3;
      if (wakeups <= 6) return 4;
      return 5;
    }

    function formatInterval(seconds) {
      if (!seconds || seconds <= 0) return 'none';
      if (seconds < 60) return seconds + 's';
      if (seconds < 3600) return Math.round(seconds / 60) + 'm';
      return (seconds / 3600).toFixed(1).replace(/\\.0$/, '') + 'h';
    }

    function escHtml(s) {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Auto-refresh: re-render the current page every 5 seconds
    let currentPage = 'chat';
    let pollTimer = null;

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (currentPage !== 'chat' && currentPage !== 'agent-detail') {
          // Skip refresh if user is typing in an input/textarea or a modal is open
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
          if (document.querySelector('.modal-overlay')) return;
          // Skip refresh if user has expanded a bulletin post
          if (document.querySelector('.bulletin-expand.open')) return;
          const content = document.getElementById('page-content');
          if (content) {
            // For activity page on schedule tab, skip full re-render (heavy + causes blink)
            if (currentPage === 'tokens') return;
            if (currentPage === 'activity' && (activityTab === 'schedule' || activityTab === 'tokens')) return;
            const renderers = { inbox: renderInbox, agents: renderAgents, tasks: renderTasks, bulletin: renderBulletin, activity: renderActivity };
            if (renderers[currentPage]) renderers[currentPage](content);
          }
        }
      }, 5000);
    }

    // Init
    (async function init() {
      await loadProjectsTree();
      updateInboxBadge();
      ensureSSE();
      showPage('chat');
      startPolling();
    })();
  </script>
</body>
</html>`;
}
