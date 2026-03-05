import type { AgentInput } from "../../core/types.js";

export interface ChatAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(to: string, text: string): Promise<void>;
  onMessage(handler: (input: AgentInput) => Promise<string>): void;
}
