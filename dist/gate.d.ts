import { z } from "zod";
import { ToolDefinition, GateResult } from "./types.js";
export declare class AgenticGate {
    private tools;
    /**
     * Registers a tool with its validation schema and execution function.
     */
    registerTool<T extends z.ZodTypeAny>(tool: ToolDefinition<T>): void;
    /**
     * Intercepts raw tool arguments from an LLM, validates them against the registered Zod schema,
     * and executes the downstream tool only if validation succeeds.
     */
    interceptAndExecute(toolName: string, rawArguments: unknown): Promise<GateResult>;
}
//# sourceMappingURL=gate.d.ts.map