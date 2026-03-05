import pino from "pino";
import { getConfig } from "../config/index.js";

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;
  const config = getConfig();

  if (process.env.NODE_ENV !== "production") {
    // Use pino-pretty writing to stderr so CLI stdout stays clean
    _logger = pino({
      level: config.LOG_LEVEL,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          destination: 2, // fd 2 = stderr
        },
      },
    });
  } else {
    // In production, write JSON to stderr directly (no transport needed)
    _logger = pino({ level: config.LOG_LEVEL }, pino.destination(2));
  }

  return _logger;
}

export function createChildLogger(name: string, bindings?: Record<string, unknown>): pino.Logger {
  return getLogger().child({ name, ...bindings });
}
