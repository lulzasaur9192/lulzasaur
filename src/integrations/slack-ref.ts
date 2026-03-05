/**
 * Singleton reference to the active Slack adapter.
 * Set at boot time so other modules can access Slack without circular imports.
 */
import type { App } from "@slack/bolt";

let _app: App | null = null;
let _botToken: string | null = null;
let _connected = false;

export function setSlackRef(app: App, botToken: string): void {
  _app = app;
  _botToken = botToken;
  _connected = true;
}

export function clearSlackRef(): void {
  _app = null;
  _botToken = null;
  _connected = false;
}

export function getSlackApp(): App | null {
  return _connected ? _app : null;
}

export function getSlackBotToken(): string | null {
  return _connected ? _botToken : null;
}

export function isSlackConnected(): boolean {
  return _connected && _app !== null;
}
