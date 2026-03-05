import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import {
  fetchTokenSummary,
  fetchTokenHourly,
  fetchTokenEntries,
} from "../api.js";
import { TokenCard } from "../components/TokenCard.js";
import { formatTokenCount } from "../utils.js";

const periods = [
  { value: 1, label: "1 hour" },
  { value: 6, label: "6 hours" },
  { value: 24, label: "24 hours" },
  { value: 168, label: "7 days" },
];

export function TokenUsage() {
  const [hours, setHours] = useState(24);

  const { data: summary } = useApi(
    () => fetchTokenSummary(hours),
    [hours]
  );
  const { data: hourly } = useApi(
    () => fetchTokenHourly(hours),
    [hours]
  );
  const { data: recent } = useApi(
    () => fetchTokenEntries(hours),
    [hours]
  );

  if (!summary || !summary.byAgent) {
    return (
      <div className="loading">
        No token usage data yet. Data is recorded after agent turns complete.
      </div>
    );
  }

  const t = summary.totals;
  const maxTokens = hourly
    ? Math.max(...hourly.map((h) => h.totalTokens), 1)
    : 1;

  return (
    <>
      <div className="period-selector">
        <span>Period:</span>
        <select
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value))}
        >
          {periods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Totals */}
      <div className="token-cards-row">
        <TokenCard label="API Calls" value={t.calls} />
        <TokenCard
          label="Input Tokens"
          value={formatTokenCount(t.totalInput)}
        />
        <TokenCard
          label="Output Tokens"
          value={formatTokenCount(t.totalOutput)}
        />
        <TokenCard
          label="Total Tokens"
          value={formatTokenCount(t.totalTokens)}
        />
        <TokenCard
          label="Est. Cost"
          value={`$${(t.estimatedCostUSD ?? 0).toFixed(2)}`}
        />
      </div>

      {/* Hourly bar chart */}
      {hourly && hourly.length > 0 && (
        <div className="bar-chart-section">
          <h3 className="section-title">Usage Over Time</h3>
          <div className="bar-chart">
            {hourly.map((h, i) => {
              const pct = Math.max(
                2,
                Math.round((h.totalTokens / maxTokens) * 100)
              );
              const label =
                h.hour.substring(11, 16) || h.hour.substring(5);
              const tooltip = `${label}\n${formatTokenCount(h.totalTokens)} tokens\n${h.calls} calls`;
              return (
                <div key={i} className="bar-col">
                  <div
                    title={tooltip}
                    className="bar"
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
          {/* X-axis labels */}
          <div className="bar-labels">
            {(() => {
              const step = Math.max(1, Math.floor(hourly.length / 12));
              return hourly.map((h, i) => {
                const label =
                  i % step === 0
                    ? h.hour.substring(11, 16) || h.hour.substring(5)
                    : "";
                return (
                  <div key={i} className="bar-label">
                    {label}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* By-agent table */}
      <h3 className="section-title">By Agent</h3>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Model</th>
            <th>Trigger</th>
            <th>Calls</th>
            <th>Input</th>
            <th>Output</th>
            <th>Total</th>
            <th>Avg Duration</th>
            <th>Est. Cost</th>
          </tr>
        </thead>
        <tbody>
          {summary.byAgent.map((r, i) => {
            const isHaiku = r.model.includes("haiku");
            const costEst =
              (r.totalInput * (isHaiku ? 0.8 : 3.0) +
                r.totalOutput * (isHaiku ? 4.0 : 15.0)) /
              1_000_000;
            const barWidth =
              t.totalTokens > 0
                ? Math.round((r.totalTokens / t.totalTokens) * 100)
                : 0;

            return (
              <tr key={i}>
                <td>
                  <strong>{r.agentName}</strong>
                </td>
                <td className="text-small">
                  {r.model.replace("claude-", "")}
                </td>
                <td>
                  <span className="trigger-badge">
                    {r.trigger}
                  </span>
                </td>
                <td>{r.calls}</td>
                <td>{formatTokenCount(r.totalInput)}</td>
                <td>{formatTokenCount(r.totalOutput)}</td>
                <td>
                  <div className="progress-inline">
                    <div className="progress-inline-track">
                      <div
                        className="progress-inline-fill"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    {formatTokenCount(r.totalTokens)}
                  </div>
                </td>
                <td>
                  {r.avgDurationMs
                    ? `${(r.avgDurationMs / 1000).toFixed(1)}s`
                    : "\u2014"}
                </td>
                <td>${costEst.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Recent calls */}
      <h3 className="section-title">Recent Calls</h3>
      {recent && recent.length > 0 ? (
        <>
          <table className="text-small">
            <thead>
              <tr>
                <th>Time</th>
                <th>Agent</th>
                <th>Model</th>
                <th>Trigger</th>
                <th>In</th>
                <th>Out</th>
                <th>Tools</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
                  <td>{r.agentName}</td>
                  <td className="text-tiny">
                    {r.model.replace("claude-", "")}
                  </td>
                  <td>{r.trigger}</td>
                  <td>{formatTokenCount(r.inputTokens)}</td>
                  <td>{formatTokenCount(r.outputTokens)}</td>
                  <td>{r.toolCalls}</td>
                  <td>
                    {r.durationMs
                      ? `${(r.durationMs / 1000).toFixed(1)}s`
                      : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.length > 50 && (
            <div className="entries-note">
              Showing 50 of {recent.length} entries
            </div>
          )}
        </>
      ) : (
        <div className="loading">
          No token usage recorded in this period.
        </div>
      )}
    </>
  );
}
