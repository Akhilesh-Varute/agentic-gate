import { z, ZodIssue } from "zod";
import { ToolDefinition, GateResult } from "./types.js";

export class AgenticGate {
  private tools = new Map<string, ToolDefinition<any>>();

  /**
   * Registers a tool with its validation schema and execution function.
   */
  registerTool<T extends z.ZodTypeAny>(tool: ToolDefinition<T>): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Intercepts raw tool arguments from an LLM, validates them against the registered Zod schema,
   * and executes the downstream tool only if validation succeeds.
   */
  async interceptAndExecute(toolName: string, rawArguments: unknown): Promise<GateResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' is not registered in the validation engine.`,
      };
    }

    // Step 1: Intercept & Validate
    const parseResult = tool.schema.safeParse(rawArguments);

    if (!parseResult.success) {
      const formattedError = parseResult.error.errors
        .map((e: ZodIssue) => `${e.path.join(".") || "parameter"}: ${e.message}`)
        .join("; ");

      return {
        success: false,
        error: `[Validation Gate Failed]: ${formattedError}`,
      };
    }

    // Step 2: Safe Downstream Execution
    try {
      const output = await tool.execute(parseResult.data);
      return { success: true, data: output };
    } catch (err: any) {
      return {
        success: false,
        error: `[Execution Failed]: ${err.message || String(err)}`,
      };
    }
  }
}