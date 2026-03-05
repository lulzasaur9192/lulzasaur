import { z } from "zod";

export const taskAssignmentContent = z.object({
  task_id: z.string(),
  title: z.string(),
  description: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const taskResultContent = z.object({
  task_id: z.string(),
  status: z.enum(["completed", "failed"]),
  result: z.record(z.string(), z.unknown()),
});

export const taskVerificationContent = z.object({
  task_id: z.string(),
  verified: z.boolean(),
  notes: z.string().optional(),
});

export const chatContent = z.object({
  text: z.string(),
});

export const systemContent = z.object({
  event: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
