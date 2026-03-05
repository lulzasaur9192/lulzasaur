import { HeartbeatSchedule } from "../db/schema.js";

export interface ScheduleMatch {
  interval: number;
  scheduleName: string | null;
}

export function getActiveScheduleInterval(
  schedules: HeartbeatSchedule[] | null | undefined,
  defaultInterval: number,
  now: Date = new Date(),
): ScheduleMatch {
  if (!schedules || schedules.length === 0) {
    return { interval: defaultInterval, scheduleName: null };
  }

  let best: ScheduleMatch | null = null;

  for (const schedule of schedules) {
    if (scheduleMatches(schedule, now)) {
      if (best === null || schedule.interval_seconds < best.interval) {
        best = { interval: schedule.interval_seconds, scheduleName: schedule.name };
      }
    }
  }

  return best ?? { interval: defaultInterval, scheduleName: null };
}

function scheduleMatches(schedule: HeartbeatSchedule, now: Date): boolean {
  const localDate = schedule.timezone ? toTimezone(now, schedule.timezone) : now;

  if (schedule.days && schedule.days.length > 0) {
    if (!schedule.days.includes(localDate.getDay())) {
      return false;
    }
  }

  if (schedule.start_time || schedule.end_time) {
    const current = toHHmm(localDate);
    const start = schedule.start_time ?? "00:00";
    const end = schedule.end_time ?? "23:59";

    if (start > end) {
      // Wraps midnight: matches if >= start OR < end
      if (current < start && current >= end) return false;
    } else {
      if (current < start || current >= end) return false;
    }
  }

  return true;
}

function toTimezone(date: Date, timezone: string): Date {
  // Construct a date string in the target timezone then parse it back.
  // This gives us a Date whose local getHours()/getDay() reflect the target tz.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month")) - 1;
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24; // hour12:false can return 24 for midnight
  const minute = Number(get("minute"));
  const second = Number(get("second"));

  return new Date(year, month, day, hour, minute, second);
}

function toHHmm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
