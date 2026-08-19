import { z } from "zod";

export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  schema: T;
  execute: (args: z.infer<T>) => Promise<unknown>;
}

export interface GateResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type GateFailureReason = "unregistered" | "validation" | "execution" | "circuit-open";

export interface GateSuccessEvent<T = unknown> {
  toolName: string;
  args: unknown;
  data: T;
}

export interface GateFailureEvent {
  toolName: string;
  args: unknown;
  error: string;
  reason: GateFailureReason;
  consecutiveFailures: number;
}

export interface GateOptions {
  /**
   * Number of consecutive validation/execution failures for a given tool
   * before the circuit trips and further calls are rejected without
   * touching the schema or execute() function. 0 disables the breaker.
   * Default: 3.
   */
  maxConsecutiveFailures?: number;
  onGateSuccess?: (event: GateSuccessEvent) => void;
  onGateFailure?: (event: GateFailureEvent) => void;
}