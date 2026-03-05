import { useApi } from "../hooks/useApi.js";
import { useApp } from "../context/AppContext.js";
import { fetchSchedule } from "../api.js";
import {
  formatInterval,
  formatTimeUntil,
  wakeupsToHeatLevel,
} from "../utils.js";
import type { ScheduleAgent } from "../types.js";

export function ScheduleHeatmap() {
  const { projects } = useApp();
  const { data } = useApi(() => fetchSchedule(), []);

  if (!data || !data.agents || data.agents.length === 0) {
    return (
      <div className="loading">No agents with heartbeat schedules.</div>
    );
  }

  const coreAgents = data.agents.filter((a) => !a.projectId);
  const projectGroups: Record<string, ScheduleAgent[]> = {};
  for (const a of data.agents) {
    if (a.projectId) {
      if (!projectGroups[a.projectId])
        projectGroups[a.projectId] = [];
      projectGroups[a.projectId]!.push(a);
    }
  }

  return (
    <>
      <HeatmapSection
        title="Core Agents"
        agents={coreAgents}
        dayHeaders={data.dayHeaders}
      />
      {Object.entries(projectGroups).map(([projectId, list]) => {
        const proj = projects.find((p) => p.id === projectId);
        const projName = proj
          ? proj.displayName
          : projectId.substring(0, 8);
        return (
          <HeatmapSection
            key={projectId}
            title={projName}
            agents={list}
            dayHeaders={data.dayHeaders}
          />
        );
      })}
      <div className="schedule-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4, 5].map((level) => (
          <span key={level} className={`swatch heat-${level}`} />
        ))}
        <span>More</span>
        <span className="entries-note">Hover cells for details</span>
      </div>
    </>
  );
}

function HeatmapSection({
  title,
  agents,
  dayHeaders,
}: {
  title: string;
  agents: ScheduleAgent[];
  dayHeaders: { dayLabel: string; date: string; isToday: boolean }[];
}) {
  if (agents.length === 0) return null;

  return (
    <>
      <h3 className="section-title">{title}</h3>
      <div className="schedule-agent-summary">
        {agents.map((a) => {
          const nextBeat = a.nextHeartbeatAt
            ? formatTimeUntil(new Date(a.nextHeartbeatAt))
            : "none";
          const defaultInt = a.defaultInterval
            ? formatInterval(a.defaultInterval)
            : "none";
          return (
            <div key={a.agentName} className="schedule-agent-chip">
              <span className={`dot ${a.status}`} />
              <strong>{a.agentName}</strong>
              <span className="interval">{defaultInt}</span>
              <span className="interval">next: {nextBeat}</span>
            </div>
          );
        })}
      </div>
      <div className="schedule-heatmap">
        <table>
          <thead>
            <tr>
              <th></th>
              {dayHeaders.map((d, i) => (
                <th
                  key={i}
                  colSpan={24}
                  className={`day-header${d.isToday ? " today" : ""}`}
                >
                  {d.dayLabel} {d.date.substring(5)}
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {dayHeaders.map((_, di) =>
                Array.from({ length: 24 }, (__, h) => (
                  <th key={`${di}-${h}`}>{h % 6 === 0 ? h : ""}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agentName}>
                <td className="agent-name">{a.agentName}</td>
                {a.hourly.map((slot, i) => {
                  const heatLevel = wakeupsToHeatLevel(slot.wakeupsPerHour);
                  const dayHeader = dayHeaders[slot.day];
                  const tooltip = `${a.agentName} \u2014 ${dayHeader?.dayLabel || ""} ${String(slot.hour).padStart(2, "0")}:00\nInterval: ${formatInterval(slot.intervalSeconds)}\nWakeups/hr: ${slot.wakeupsPerHour}${slot.scheduleName ? `\nSchedule: ${slot.scheduleName}` : ""}`;
                  return (
                    <td key={i} className="heat-cell">
                      <span
                        className={`cell heat-${heatLevel}`}
                        title={tooltip}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
