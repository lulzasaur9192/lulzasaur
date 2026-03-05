export class LulzasaurError extends Error {
  constructor(message: string, public readonly code: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "LulzasaurError";
  }
}

export class AgentError extends LulzasaurError {
  constructor(message: string, public readonly agentId: string, context?: Record<string, unknown>) {
    super(message, "AGENT_ERROR", { agentId, ...context });
    this.name = "AgentError";
  }
}

export class TaskError extends LulzasaurError {
  constructor(message: string, public readonly taskId: string, context?: Record<string, unknown>) {
    super(message, "TASK_ERROR", { taskId, ...context });
    this.name = "TaskError";
  }
}

export class LLMError extends LulzasaurError {
  constructor(message: string, public readonly provider: string, context?: Record<string, unknown>) {
    super(message, "LLM_ERROR", { provider, ...context });
    this.name = "LLMError";
  }
}

export class ToolError extends LulzasaurError {
  constructor(message: string, public readonly toolName: string, context?: Record<string, unknown>) {
    super(message, "TOOL_ERROR", { toolName, ...context });
    this.name = "ToolError";
  }
}
