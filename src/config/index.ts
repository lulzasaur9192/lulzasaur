import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur"),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),

  DEFAULT_LLM_PROVIDER: z.string().default("anthropic"),
  DEFAULT_LLM_MODEL: z.string().default("claude-sonnet-4-6"),

  WEB_PORT: z.coerce.number().default(3000),
  WEB_HOST: z.string().default("0.0.0.0"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("warn"),

  HEARTBEAT_POLL_INTERVAL_SECONDS: z.coerce.number().default(30),

  SHELL_TIMEOUT_MS: z.coerce.number().default(30000),
  SHELL_MAX_OUTPUT_BYTES: z.coerce.number().default(1_048_576),

  MODULES_DIR: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_ALLOWED_CHANNELS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  // Always re-parse from process.env to pick up dotenv values
  // (ESM import hoisting can cause early singleton caching before dotenv loads)
  _config = envSchema.parse(process.env);
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
