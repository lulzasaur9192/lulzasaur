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
      /* Colors — Apple warm dark */
      --bg: #1c1c1e;
      --surface: #2c2c2e;
      --surface-raised: #3a3a3c;
      --border: rgba(255,255,255,0.08);
      --border-strong: rgba(255,255,255,0.15);
      --text: #f5f5f7;
      --text-muted: #a1a1a6;
      --text-tertiary: #6e6e73;
      --accent: #0a84ff;
      --accent-subtle: rgba(10,132,255,0.2);
      --green: #30d158;
      --green-subtle: rgba(48,209,88,0.18);
      --yellow: #ffd60a;
      --yellow-subtle: rgba(255,214,10,0.18);
      --red: #ff453a;
      --red-subtle: rgba(255,69,58,0.18);
      --purple: #bf5af2;
      --purple-subtle: rgba(191,90,242,0.18);

      /* Glassmorphism */
      --glass-bg: rgba(255,255,255,0.05);
      --glass-border: rgba(255,255,255,0.1);
      --glass-blur: blur(12px);
      --glass-glow: 0 0 20px rgba(10,132,255,0.15);

      /* Shadows */
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2);
      --shadow-lg: 0 8px 28px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.2);
      --shadow-xl: 0 16px 48px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.25);

      /* Radii */
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-full: 9999px;

      /* Transitions */
      --ease-out: cubic-bezier(0.25, 0.46, 0.45, 0.94);
      --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --duration-fast: 0.15s;
      --duration-normal: 0.25s;
      --duration-slow: 0.4s;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .app { display: flex; height: 100vh; }

    /* ── Sidebar — Glassmorphism ── */
    .sidebar {
      width: 260px;
      background: rgba(44,44,46,0.72);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-right: 1px solid var(--glass-border);
      box-shadow: inset -1px 0 0 rgba(255,255,255,0.05);
      padding: 20px;
      flex-shrink: 0;
      overflow-y: auto;
      z-index: 10;
    }
    .sidebar h1 {
      font-size: 18px;
      margin-bottom: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      background-size: 200% 200%;
      animation: shimmer 6s ease-in-out infinite;
    }
    .sidebar h1 span { font-size: 22px; -webkit-text-fill-color: initial; }
    @keyframes shimmer {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    .nav-section { font-size: 12px; color: var(--text-tertiary); margin-top: 24px; margin-bottom: 8px; padding: 0 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .nav-item { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; margin: 2px 0; border-radius: var(--radius-md); color: var(--text-muted); cursor: pointer; text-decoration: none; font-size: 14px; transition: all var(--duration-fast) var(--ease-out); }
    .nav-item:hover { background: rgba(255,255,255,0.08); color: var(--text); }
    .nav-item.active {
      background: linear-gradient(135deg, var(--accent), var(--purple));
      color: #fff;
      box-shadow: 0 0 16px rgba(10,132,255,0.3), 0 0 4px rgba(191,90,242,0.2);
    }

    /* ── Main + Animated Background ── */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .main::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 20% 50%, rgba(10,132,255,0.06) 0%, transparent 50%),
                  radial-gradient(ellipse at 80% 20%, rgba(191,90,242,0.05) 0%, transparent 50%),
                  radial-gradient(ellipse at 50% 80%, rgba(48,209,88,0.04) 0%, transparent 50%);
      background-size: 200% 200%;
      animation: meshMove 20s ease-in-out infinite;
      pointer-events: none;
      z-index: 0;
    }
    @keyframes meshMove {
      0%, 100% { background-position: 0% 0%; }
      25% { background-position: 100% 0%; }
      50% { background-position: 100% 100%; }
      75% { background-position: 0% 100%; }
    }

    /* ── Header — Hero Style ── */
    .header {
      padding: 28px 32px 24px;
      background: linear-gradient(135deg, rgba(10,132,255,0.08) 0%, rgba(191,90,242,0.06) 100%);
      border-bottom: 1px solid var(--glass-border);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      position: relative;
      z-index: 1;
    }
    .header-title {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.2;
    }
    .header-subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 6px;
      font-weight: 400;
    }

    /* ── Content — Fade In ── */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 32px;
      position: relative;
      z-index: 1;
      animation: contentFadeIn var(--duration-normal) var(--ease-out);
    }
    @keyframes contentFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Tree nodes */
    .tree-node { padding-left: 12px; }
    .tree-toggle { display: flex; align-items: center; gap: 6px; padding: 8px 12px; margin: 2px 0; border-radius: var(--radius-md); color: var(--text-muted); cursor: pointer; font-size: 14px; transition: all var(--duration-fast) var(--ease-out); }
    .tree-toggle:hover { background: rgba(255,255,255,0.06); color: var(--text); }
    .tree-toggle .arrow { font-size: 10px; transition: transform var(--duration-normal) var(--ease-out); display: inline-block; width: 12px; }
    .tree-toggle .arrow.open { transform: rotate(90deg); }
    .tree-children { display: none; padding-left: 8px; overflow: hidden; }
    .tree-children.open { display: block; animation: fadeIn var(--duration-normal) var(--ease-out); }
    .tree-leaf { display: block; padding: 6px 12px 6px 20px; margin: 1px 0; border-radius: var(--radius-md); color: var(--text-muted); cursor: pointer; text-decoration: none; font-size: 13px; transition: all var(--duration-fast) var(--ease-out); }
    .tree-leaf:hover { background: rgba(255,255,255,0.06); color: var(--text); }
    .tree-leaf.active { background: linear-gradient(135deg, var(--accent), var(--purple)); color: #fff; }
    .project-badge { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 6px; }
    .project-badge.inactive { background: var(--text-muted); }

    /* ── Tables — Glass Hover ── */
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 500; font-size: 13px; }
    tr:hover {
      background: var(--glass-bg);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: rgba(255,255,255,0.07); }

    /* ── Badges — Glow ── */
    .badge { display: inline-block; padding: 3px 10px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600; }
    .badge.idle { background: var(--accent-subtle); color: var(--accent); box-shadow: 0 0 8px rgba(10,132,255,0.15); }
    .badge.active { background: var(--green-subtle); color: var(--green); box-shadow: 0 0 8px rgba(48,209,88,0.15); }
    .badge.sleeping { background: var(--yellow-subtle); color: var(--yellow); box-shadow: 0 0 8px rgba(255,214,10,0.12); }
    .badge.terminated { background: var(--red-subtle); color: var(--red); box-shadow: 0 0 8px rgba(255,69,58,0.12); }
    .badge.pending { background: var(--yellow-subtle); color: var(--yellow); box-shadow: 0 0 8px rgba(255,214,10,0.12); }
    .badge.assigned { background: var(--accent-subtle); color: var(--accent); box-shadow: 0 0 8px rgba(10,132,255,0.12); }
    .badge.in_progress { background: var(--purple-subtle); color: var(--purple); box-shadow: 0 0 8px rgba(191,90,242,0.15); }
    .badge.review_pending { background: var(--yellow-subtle); color: var(--yellow); }
    .badge.completed { background: var(--green-subtle); color: var(--green); box-shadow: 0 0 8px rgba(48,209,88,0.12); }
    .badge.failed { background: var(--red-subtle); color: var(--red); }
    .badge.unverified { background: var(--yellow-subtle); color: var(--yellow); }
    .badge.verified { background: var(--green-subtle); color: var(--green); }
    .badge.rejected { background: var(--red-subtle); color: var(--red); }
    .badge.epic { background: var(--purple-subtle); color: var(--purple); box-shadow: 0 0 8px rgba(191,90,242,0.12); }
    .badge.task { background: var(--accent-subtle); color: var(--accent); }
    .badge.review { background: var(--yellow-subtle); color: var(--yellow); }
    .badge.proposal { background: var(--purple-subtle); color: var(--purple); }
    .badge.question { background: var(--accent-subtle); color: var(--accent); }
    .badge.alert { background: var(--red-subtle); color: var(--red); }
    .badge.update { background: var(--green-subtle); color: var(--green); }

    /* ── Kanban — Glass Cards + Staggered Entrance ── */
    .kanban { display: flex; gap: 20px; overflow-x: auto; }
    .kanban-col { min-width: 260px; flex: 1; }
    .kanban-col h3 { font-size: 13px; color: var(--text-muted); margin-bottom: 14px; cursor: pointer; user-select: none; font-weight: 600; }
    .kanban-col h3 .toggle-arrow { display: inline-block; font-size: 10px; margin-right: 6px; transition: transform var(--duration-normal) var(--ease-out); }
    .kanban-col.collapsed h3 .toggle-arrow { transform: rotate(-90deg); }
    .kanban-col.collapsed .kanban-card { display: none; }
    .kanban-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 16px;
      margin-bottom: 10px;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out), border-color var(--duration-fast);
      animation: cardEntrance var(--duration-slow) var(--ease-out) both;
    }
    .kanban-card:nth-child(1) { animation-delay: 0ms; }
    .kanban-card:nth-child(2) { animation-delay: 50ms; }
    .kanban-card:nth-child(3) { animation-delay: 100ms; }
    .kanban-card:nth-child(4) { animation-delay: 150ms; }
    .kanban-card:nth-child(5) { animation-delay: 200ms; }
    .kanban-card:nth-child(n+6) { animation-delay: 250ms; }
    .kanban-card:hover {
      transform: translateY(-3px);
      border-color: var(--accent);
      box-shadow: 0 8px 24px rgba(10,132,255,0.2), 0 0 12px rgba(10,132,255,0.1);
    }
    .kanban-card .title { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    .kanban-card .desc { font-size: 13px; color: var(--text-muted); }
    .kanban-card .priority { font-size: 12px; color: var(--yellow); margin-top: 6px; }
    @keyframes cardEntrance {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Epic cards — Glass ── */
    .epic-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out);
      animation: cardEntrance var(--duration-slow) var(--ease-out) both;
    }
    .epic-card:nth-child(1) { animation-delay: 0ms; }
    .epic-card:nth-child(2) { animation-delay: 60ms; }
    .epic-card:nth-child(3) { animation-delay: 120ms; }
    .epic-card:nth-child(n+4) { animation-delay: 180ms; }
    .epic-card:hover {
      box-shadow: 0 8px 24px rgba(191,90,242,0.15), var(--shadow-md);
      transform: translateY(-2px);
    }
    .epic-card .epic-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .epic-card .epic-desc { font-size: 14px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5; }
    .epic-card .progress-bar { height: 6px; background: var(--border-strong); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .epic-card .progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--green)); border-radius: 3px; transition: width var(--duration-slow) var(--ease-out); }
    .epic-card .progress-text { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
    .epic-card .child-tasks { border-top: 1px solid var(--border); padding-top: 12px; }
    .epic-card .child-task { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; cursor: pointer; transition: color var(--duration-fast); }
    .epic-card .child-task:hover { color: var(--accent); }

    /* ── Modal — Glass Panel ── */
    .modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
      animation: fadeIn var(--duration-fast) var(--ease-out);
    }
    .modal {
      background: rgba(44,44,46,0.85);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      padding: 32px;
      width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: var(--shadow-xl), 0 0 40px rgba(10,132,255,0.08);
      animation: modalSlideUp 0.3s var(--ease-spring);
    }
    .modal h2 { font-size: 20px; margin-bottom: 20px; font-weight: 700; }
    .modal label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; margin-top: 14px; font-weight: 500; }
    .modal input, .modal select, .modal textarea { width: 100%; padding: 10px 14px; background: rgba(28,28,30,0.8); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text); font-size: 14px; font-family: inherit; outline: none; transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out); }
    .modal input:focus, .modal select:focus, .modal textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 12px rgba(10,132,255,0.15); }
    .modal textarea { min-height: 80px; resize: vertical; }
    .modal-actions { display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; }
    .modal-actions button { padding: 10px 20px; border-radius: var(--radius-md); border: none; cursor: pointer; font-size: 14px; font-weight: 600; transition: transform var(--duration-fast) var(--ease-out), opacity var(--duration-fast), box-shadow var(--duration-fast); }
    .modal-actions button:active { transform: scale(0.97); }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent), var(--purple));
      color: #fff;
      box-shadow: 0 0 12px rgba(10,132,255,0.2);
    }
    .btn-primary:hover { opacity: 0.9; transform: scale(1.02); box-shadow: 0 0 20px rgba(10,132,255,0.3); }
    .btn-danger { background: var(--red); color: #fff; }
    .btn-danger:hover { opacity: 0.9; transform: scale(1.02); }
    .btn-success { background: var(--green); color: #fff; }
    .btn-success:hover { opacity: 0.9; transform: scale(1.02); }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border-strong); }
    .btn-ghost:hover { color: var(--text); background: rgba(255,255,255,0.05); }

    /* ── Bulletin — Glass Posts ── */
    .bulletin-filters { display: flex; gap: 8px; margin-bottom: 20px; }
    .bulletin-filters button { padding: 7px 16px; border-radius: var(--radius-full); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 13px; transition: all var(--duration-fast) var(--ease-out); }
    .bulletin-filters button:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .bulletin-filters button.active { background: linear-gradient(135deg, var(--accent), var(--purple)); color: #fff; border-color: transparent; box-shadow: 0 0 10px rgba(10,132,255,0.2); }
    .bulletin-post {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      margin-bottom: 6px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--duration-fast), transform var(--duration-fast);
    }
    .bulletin-post:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
    .bulletin-post.pinned { border-color: var(--yellow); box-shadow: 0 0 10px rgba(255,214,10,0.1); }
    .bulletin-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; transition: background var(--duration-fast); }
    .bulletin-row:hover { background: rgba(255,255,255,0.03); }
    .bulletin-row .post-channel { font-size: 11px; padding: 3px 10px; border-radius: var(--radius-full); background: rgba(255,255,255,0.06); color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-title { font-size: 14px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bulletin-row .post-author { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-time { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .bulletin-row .post-tags { display: flex; gap: 4px; }
    .bulletin-row .tag { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); background: var(--accent-subtle); color: var(--accent); }
    .bulletin-row .pin-icon { color: var(--yellow); font-size: 12px; }
    .bulletin-expand { display: none; padding: 0 16px 16px 16px; border-top: 1px solid var(--border); }
    .bulletin-expand.open { display: block; animation: fadeIn var(--duration-normal) var(--ease-out); }
    .bulletin-expand .post-body { font-size: 14px; color: var(--text-muted); line-height: 1.65; white-space: pre-wrap; padding: 14px 0; }
    .bulletin-expand .post-replies { margin-top: 10px; padding-left: 16px; border-left: 2px solid var(--border-strong); }
    .bulletin-expand .reply { padding: 8px 0; font-size: 13px; }
    .bulletin-expand .reply .reply-author { color: var(--accent); font-weight: 600; }
    .bulletin-expand .reply .reply-time { color: var(--text-muted); font-size: 12px; margin-left: 8px; }

    /* Activity */
    .activity-item { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
    .activity-item .time { color: var(--text-muted); font-size: 12px; }

    /* ── Schedule heatmap ── */
    .schedule-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .schedule-tabs button { padding: 7px 16px; border-radius: var(--radius-full); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 13px; transition: all var(--duration-fast) var(--ease-out); }
    .schedule-tabs button:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .schedule-tabs button.active { background: linear-gradient(135deg, var(--accent), var(--purple)); color: #fff; border-color: transparent; box-shadow: 0 0 10px rgba(10,132,255,0.2); }
    .schedule-heatmap { overflow-x: auto; }
    .schedule-heatmap table { border-collapse: separate; border-spacing: 2px; width: 100%; table-layout: fixed; }
    .schedule-heatmap th { font-size: 10px; color: var(--text-muted); padding: 4px 2px; text-align: center; font-weight: 500; }
    .schedule-heatmap th.day-header { font-size: 12px; font-weight: 700; color: var(--text); border-bottom: 2px solid var(--accent); padding-bottom: 6px; }
    .schedule-heatmap th.today { color: var(--accent); text-shadow: 0 0 8px rgba(10,132,255,0.4); }
    .schedule-heatmap td.agent-name { font-size: 13px; font-weight: 600; white-space: nowrap; padding: 8px 12px; position: sticky; left: 0; background: var(--bg); z-index: 1; border-right: 1px solid var(--border); }
    .schedule-heatmap td.heat-cell { padding: 0; text-align: center; min-width: 22px; height: 30px; border: none; }
    .schedule-heatmap td.heat-cell .cell { display: block; width: 100%; height: 100%; border-radius: 4px; transition: opacity var(--duration-fast), transform var(--duration-fast); cursor: default; }
    .schedule-heatmap td.heat-cell .cell:hover { opacity: 0.85; transform: scale(1.15); z-index: 2; position: relative; }
    .heat-0 { background: rgba(255,255,255,0.03); }
    .heat-1 { background: rgba(10,132,255,0.15); }
    .heat-2 { background: rgba(10,132,255,0.3); }
    .heat-3 { background: rgba(48,209,88,0.35); }
    .heat-4 { background: rgba(48,209,88,0.55); }
    .heat-5 { background: var(--green); box-shadow: 0 0 6px rgba(48,209,88,0.3); }
    .schedule-legend { display: flex; align-items: center; gap: 6px; margin-top: 14px; font-size: 12px; color: var(--text-muted); }
    .schedule-legend .swatch { width: 14px; height: 14px; border-radius: 3px; }
    .schedule-agent-summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
    .schedule-agent-chip {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 10px 16px;
      font-size: 13px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--duration-fast), transform var(--duration-fast);
    }
    .schedule-agent-chip:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
    .schedule-agent-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
    .schedule-agent-chip .dot.idle { background: var(--green); }
    .schedule-agent-chip .dot.active { background: var(--yellow); }
    .schedule-agent-chip .interval { color: var(--text-muted); }

    /* Agent Detail */
    .agent-detail-back { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: pointer; font-size: 14px; margin-bottom: 20px; padding: 6px 0; transition: color var(--duration-fast); }
    .agent-detail-back:hover { color: var(--accent); }
    .agent-detail-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
    .agent-detail-header h2 { font-size: 22px; font-weight: 700; }
    .agent-detail-meta { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 24px; font-size: 14px; color: var(--text-muted); }
    .agent-detail-meta .meta-item { display: flex; align-items: center; gap: 8px; }
    .agent-detail-meta .meta-label { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
    .detail-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
    .detail-tab { padding: 10px 20px; font-size: 14px; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all var(--duration-fast) var(--ease-out); }
    .detail-tab:hover { color: var(--text); }
    .detail-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    /* Claude Code Terminal */
    .cc-terminal { background: #010409; border: 1px solid var(--glass-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-lg); }
    .cc-terminal-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: rgba(44,44,46,0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
    .cc-terminal-header .cc-status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .cc-terminal-header .cc-dot { width: 8px; height: 8px; border-radius: 50%; }
    .cc-dot.running { background: var(--green); animation: pulse 1.5s infinite; box-shadow: 0 0 8px rgba(48,209,88,0.4); }
    .cc-dot.idle { background: var(--text-muted); }
    .cc-dot.error { background: var(--red); box-shadow: 0 0 8px rgba(255,69,58,0.4); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .cc-terminal-body { padding: 14px 16px; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 13px; line-height: 1.65; color: var(--text); max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .cc-terminal-body .cc-line { padding: 2px 0; }
    .cc-terminal-body .cc-line.start { color: var(--accent); }
    .cc-terminal-body .cc-line.complete { color: var(--green); }
    .cc-terminal-body .cc-line.error { color: var(--red); }
    .cc-terminal-body .cc-line.status { color: var(--yellow); }
    .cc-terminal-body .cc-line .cc-time { color: var(--text-muted); margin-right: 10px; font-size: 12px; }
    .cc-empty { padding: 48px 24px; text-align: center; color: var(--text-muted); font-size: 14px; }
    .cc-terminal-actions { display: flex; gap: 8px; }
    .cc-terminal-actions button { padding: 5px 12px; font-size: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; transition: all var(--duration-fast); }
    .cc-terminal-actions button:hover { color: var(--text); border-color: var(--text-muted); background: rgba(255,255,255,0.05); }

    .loading { color: var(--text-muted); font-style: italic; padding: 8px 0; }
    .agent-select { margin-bottom: 20px; }
    .agent-select select { padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text); font-size: 14px; }

    /* ── Token Cards — Glass ── */
    .token-card {
      padding: 16px 20px;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      min-width: 110px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
    }
    .token-card:hover { box-shadow: var(--shadow-md), 0 0 12px rgba(10,132,255,0.08); transform: translateY(-2px); }
    .token-card-label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
    .token-card-value { font-size: 24px; font-weight: 700; margin-top: 4px; letter-spacing: -0.02em; }

    /* TokenUsage / AgentsPage / ScheduleHeatmap shared */
    .section-title { margin: 24px 0 10px; font-size: 15px; color: var(--text-muted); font-weight: 600; }
    .section-title:first-child { margin-top: 0; }

    /* TokenUsage specific */
    .period-selector { margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
    .period-selector span { font-size: 13px; color: var(--text-muted); }
    .period-selector select { padding: 6px 10px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
    .period-selector select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
    .token-cards-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; padding: 4px 0; border-bottom: 1px solid var(--border); }
    .bar-chart-section { margin-bottom: 28px; }
    .bar { width: 100%; max-width: 32px; background: linear-gradient(to top, var(--accent), var(--purple)); border-radius: 4px 4px 0 0; min-height: 2px; cursor: default; transition: opacity var(--duration-fast); }
    .bar:hover { opacity: 0.8; }
    .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 0; }
    .bar-labels { display: flex; gap: 2px; }
    .bar-label { flex: 1; text-align: center; font-size: 10px; color: var(--text-muted); min-width: 0; overflow: hidden; }
    .progress-inline { display: flex; align-items: center; gap: 8px; }
    .progress-inline-track { width: 60px; height: 8px; background: var(--border-strong); border-radius: 4px; overflow: hidden; }
    .progress-inline-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--purple)); border-radius: 4px; }
    .trigger-badge { padding: 2px 8px; border-radius: var(--radius-full); font-size: 11px; background: linear-gradient(135deg, var(--accent), var(--purple)); color: #fff; }
    .text-small { font-size: 12px; }
    .text-tiny { font-size: 11px; }
    .entries-note { color: var(--text-muted); font-size: 12px; margin-top: 6px; }

    /* AgentsPage */
    .filter-row { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
    .filter-row label { font-size: 14px; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .agent-count { font-size: 13px; color: var(--text-muted); }

    /* ── Agent Cards Grid ── */
    .agent-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .agent-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 20px;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out);
      animation: cardEntrance var(--duration-slow) var(--ease-out) both;
    }
    .agent-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md), 0 0 16px rgba(10,132,255,0.1); }
    .agent-card-top { margin-bottom: 12px; }
    .agent-card-name { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .agent-card-name strong { font-size: 15px; }
    .agent-card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-muted); }

    /* ── Heartbeat section inside agent card ── */
    .agent-card-heartbeat {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 10px 12px;
      cursor: pointer;
      transition: background var(--duration-fast);
    }
    .agent-card-heartbeat:hover { background: rgba(255,255,255,0.06); }
    .agent-card-heartbeat.error { border-left: 3px solid var(--red); }
    .agent-card-heartbeat.skipped { opacity: 0.6; }
    .hb-summary-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
    .hb-time { font-weight: 600; color: var(--text); }
    .hb-duration { color: var(--text-muted); }
    .hb-tools { color: var(--accent); font-weight: 500; }
    .hb-skipped-label { color: var(--text-tertiary); font-style: italic; }
    .hb-error-label { color: var(--red); font-weight: 600; }
    .hb-expand-hint { margin-left: auto; color: var(--text-tertiary); font-size: 10px; }
    .hb-preview { font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .hb-full-response { font-size: 13px; color: var(--text); margin-top: 8px; line-height: 1.65; white-space: pre-wrap; max-height: 300px; overflow-y: auto; padding: 8px; background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); }
    .hb-error-text { font-size: 12px; color: var(--red); margin-top: 6px; line-height: 1.4; }

    /* ── Heartbeat Timeline (HeartbeatsTab + HeartbeatLog) ── */
    .hb-timeline { display: flex; flex-direction: column; gap: 8px; }
    .hb-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 14px 18px;
      cursor: pointer;
      transition: transform var(--duration-fast), box-shadow var(--duration-fast), border-color var(--duration-fast);
      animation: cardEntrance var(--duration-slow) var(--ease-out) both;
    }
    .hb-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
    .hb-card.expanded { border-color: var(--accent); box-shadow: 0 0 12px rgba(10,132,255,0.1); }
    .hb-card.error { border-left: 3px solid var(--red); }
    .hb-card.skipped { opacity: 0.55; }
    .hb-card-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .hb-card-agent { font-size: 14px; font-weight: 600; color: var(--text); min-width: 120px; }
    .hb-card-time { font-size: 13px; color: var(--text-muted); }
    .hb-card-indicators { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .hb-pill { display: inline-block; padding: 2px 8px; border-radius: var(--radius-full); font-size: 11px; font-weight: 600; background: rgba(255,255,255,0.08); color: var(--text-muted); }
    .hb-pill.tools { background: var(--accent-subtle); color: var(--accent); }
    .hb-pill.ok { background: var(--green-subtle); color: var(--green); }
    .hb-pill.err { background: var(--red-subtle); color: var(--red); }
    .hb-pill.skip { background: rgba(255,255,255,0.05); color: var(--text-tertiary); }
    .hb-expand-arrow { color: var(--text-tertiary); font-size: 10px; margin-left: 4px; }
    .hb-card-preview { font-size: 13px; color: var(--text-muted); margin-top: 10px; line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .hb-card-body {
      font-size: 13px;
      color: var(--text);
      margin-top: 12px;
      line-height: 1.65;
      white-space: pre-wrap;
      padding: 12px 14px;
      background: rgba(0,0,0,0.25);
      border-radius: var(--radius-md);
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid var(--border);
    }
    .hb-card-error { font-size: 12px; color: var(--red); margin-top: 8px; line-height: 1.4; }

    /* ── Conversation Cards — Glass ── */
    .conversation-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 16px;
      margin-bottom: 10px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--duration-fast), transform var(--duration-fast);
    }
    .conversation-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
    .conversation-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .conversation-header strong { font-size: 14px; }
    .conversation-meta { font-size: 12px; color: var(--text-muted); }
    .conversation-preview { font-size: 13px; color: var(--text-muted); }

    /* HeartbeatLog / HeartbeatsTab */
    .summary-cell { max-width: 400px; font-size: 13px; }
    .status-ok { color: var(--green); }
    .status-error { color: var(--red); }

    /* TasksPage */
    .kanban-card-badges { display: flex; gap: 4px; margin-bottom: 6px; }
    .kanban-card-verification { margin-top: 8px; }

    /* TaskEditModal */
    .task-type-display { font-size: 14px; padding: 6px 0; }
    .task-result-pre { font-size: 13px; color: var(--text-muted); background: var(--bg); padding: 10px; border-radius: var(--radius-md); overflow-x: auto; max-height: 120px; font-family: 'SF Mono', 'Menlo', monospace; line-height: 1.5; }
    .task-verification-notes { font-size: 13px; color: var(--text-muted); padding: 6px 0; line-height: 1.5; }

    /* ProjectEpicsPage */
    .epic-badges { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }

    /* AgentTable */
    .agent-id-hint { color: var(--text-muted); font-size: 12px; }

    /* ── Trash ── */
    .trash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
    .trash-empty-btn { padding: 8px 18px; border-radius: var(--radius-md); border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: transform var(--duration-fast), opacity var(--duration-fast); }
    .trash-empty-btn:active { transform: scale(0.97); }
    .trash-confirm { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--red); }
    .trash-confirm-btn { padding: 6px 14px; border-radius: var(--radius-md); border: none; cursor: pointer; font-size: 12px; font-weight: 600; }
    .trash-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      padding: 16px 20px;
      margin-bottom: 8px;
      box-shadow: var(--shadow-sm);
      border-left: 3px solid var(--text-muted);
      transition: box-shadow var(--duration-fast), transform var(--duration-fast);
      animation: cardEntrance var(--duration-slow) var(--ease-out) both;
    }
    .trash-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
    .trash-border-accent { border-left-color: var(--accent); }
    .trash-border-purple { border-left-color: var(--purple); }
    .trash-border-green { border-left-color: var(--green); }
    .trash-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .trash-card-preview { font-size: 14px; color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trash-card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; flex-wrap: wrap; }
    .trash-card-reason { font-style: italic; }
    .trash-actions { display: flex; gap: 8px; }
    .trash-action-btn { padding: 5px 14px; border-radius: var(--radius-md); border: none; cursor: pointer; font-size: 12px; font-weight: 600; transition: transform var(--duration-fast), opacity var(--duration-fast); }
    .trash-action-btn:hover { opacity: 0.9; transform: scale(1.02); }
    .trash-action-btn:active { transform: scale(0.97); }

    /* ── Animations ── */
    @keyframes modalSlideUp {
      from { opacity: 0; transform: translateY(16px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Scrollbar — Accent ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(10,132,255,0.3); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(10,132,255,0.5); }

    /* ── Focus Ring — Glow ── */
    *:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--accent), 0 0 12px rgba(10,132,255,0.3);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/dashboard.js"></script>
</body>
</html>`;
}
