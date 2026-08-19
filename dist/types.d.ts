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
export interface GateOptions {
    maxRetries?: number;
}
//# sourceMappingURL=types.d.ts.map