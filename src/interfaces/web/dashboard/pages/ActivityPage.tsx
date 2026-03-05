import { useState } from "react";
import { ScheduleHeatmap } from "./ScheduleHeatmap.js";
import { HeartbeatLog } from "./HeartbeatLog.js";
import { TokenUsage } from "./TokenUsage.js";

type ActivityTab = "schedule" | "heartbeats" | "tokens";

export function ActivityPage() {
  const [tab, setTab] = useState<ActivityTab>("schedule");

  return (
    <>
      <div className="schedule-tabs">
        <button
          className={tab === "schedule" ? "active" : ""}
          onClick={() => setTab("schedule")}
        >
          Schedule
        </button>
        <button
          className={tab === "heartbeats" ? "active" : ""}
          onClick={() => setTab("heartbeats")}
        >
          Heartbeat Log
        </button>
        <button
          className={tab === "tokens" ? "active" : ""}
          onClick={() => setTab("tokens")}
        >
          Token Usage
        </button>
      </div>
      {tab === "schedule" && <ScheduleHeatmap />}
      {tab === "heartbeats" && <HeartbeatLog />}
      {tab === "tokens" && <TokenUsage />}
    </>
  );
}
