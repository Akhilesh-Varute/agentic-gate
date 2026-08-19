import { z } from "zod";
import { ToolDefinition, GateResult, GateOptions } from "./types.js";
export declare class AgenticGate {
    private tools;
    private consecutiveFailures;
    private readonly maxConsecutiveFailures;
    private readonly onGateSuccess?;
    private readonly onGateFailure?;
    constructor(options?: GateOptions);
    /**
     * Registers a tool with its validation schema and execution function.
     */
    registerTool<T extends z.ZodTypeAny>(tool: ToolDefinition<T>): void;
    /**
     * Manually resets the circuit breaker's failure count for a tool,
     * e.g. after an operator has addressed the underlying issue.
     */
    resetCircuit(toolName: string): void;
    /**
     * Intercepts raw tool arguments from an LLM, validates them against the registered Zod schema,
     * and executes the downstream tool only if validation succeeds.
     */
    interceptAndExecute(toolName: string, rawArguments: unknown): Promise<GateResult>;
    private isCircuitOpen;
    private fail;
}
//# sourceMappingURL=gate.d.ts.map