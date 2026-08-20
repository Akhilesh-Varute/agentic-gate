import { z } from "zod";
export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    schema: T;
    /**
     * Optional async check against real external state, run after the schema
     * passes but before execute() — e.g. confirming an EC2 instance ID actually
     * exists via the AWS SDK before allowing the action to proceed. Throw an
     * Error (with a message safe to feed back to the LLM) to reject the call;
     * resolving normally allows execute() to run.
     */
    validate?: (args: z.infer<T>) => Promise<void>;
    execute: (args: z.infer<T>) => Promise<unknown>;
}
export interface GateResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}
export type GateFailureReason = "unregistered" | "validation" | "async-validation" | "execution" | "circuit-open";
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
//# sourceMappingURL=types.d.ts.map