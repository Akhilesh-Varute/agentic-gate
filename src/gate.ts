import { z, ZodIssue } from "zod";
import { ToolDefinition, GateResult, GateOptions, GateFailureReason } from "./types.js";

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

class ValidateTimeout extends Error {}

export class AgenticGate {
  private tools = new Map<string, ToolDefinition<any>>();
  private consecutiveFailures = new Map<string, number>();
  private readonly maxConsecutiveFailures: number;
  private readonly validateTimeoutMs?: number;
  private readonly onGateSuccess?: GateOptions["onGateSuccess"];
  private readonly onGateFailure?: GateOptions["onGateFailure"];

  constructor(options: GateOptions = {}) {
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.validateTimeoutMs = options.validateTimeoutMs;
    this.onGateSuccess = options.onGateSuccess;
    this.onGateFailure = options.onGateFailure;
  }

  /**
   * Registers a tool with its validation schema and execution function.
   */
  registerTool<T extends z.ZodTypeAny>(tool: ToolDefinition<T>): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Manually resets the circuit breaker's failure count for a tool,
   * e.g. after an operator has addressed the underlying issue.
   */
  resetCircuit(toolName: string): void {
    this.consecutiveFailures.delete(toolName);
  }

  /**
   * Intercepts raw tool arguments from an LLM, validates them against the registered Zod schema
   * (and the tool's optional async validate() check), and executes the downstream tool only if
   * both succeed.
   */
  async interceptAndExecute(toolName: string, rawArguments: unknown): Promise<GateResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return this.fail(toolName, rawArguments, "unregistered", `Tool '${toolName}' is not registered in the validation engine.`);
    }

    // Step 0: Circuit Breaker — refuse to touch the schema/execute() once a tool
    // has failed too many times in a row, to stop runaway LLM retry loops.
    if (this.isCircuitOpen(toolName)) {
      const failures = this.consecutiveFailures.get(toolName) ?? 0;
      return this.fail(
        toolName,
        rawArguments,
        "circuit-open",
        `[Circuit Breaker OPEN]: Tool '${toolName}' has failed ${failures} consecutive times. Call gate.resetCircuit("${toolName}") once the underlying issue is resolved.`
      );
    }

    // Step 0.5: OpenAI-style endpoints send arguments as a JSON string; truncated
    // or malformed strings get their own rejection reason, separate from schema errors.
    if (typeof rawArguments === "string") {
      try {
        rawArguments = JSON.parse(rawArguments);
      } catch (err: any) {
        return this.fail(
          toolName,
          rawArguments,
          "parse",
          `[Argument Parse Failed]: arguments are not valid JSON (possibly truncated): ${err.message}`
        );
      }
    }

    // Step 1: Intercept & Validate
    const parseResult = tool.schema.safeParse(rawArguments);

    if (!parseResult.success) {
      const formattedError = parseResult.error.errors
        .map((e: ZodIssue) => `${e.path.join(".") || "parameter"}: ${e.message}`)
        .join("; ");

      return this.fail(toolName, rawArguments, "validation", `[Validation Gate Failed]: ${formattedError}`);
    }

    // Step 2: Async External-State Validation (e.g. does this resource actually exist?)
    if (tool.validate) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const check = tool.validate(parseResult.data);
        if (this.validateTimeoutMs === undefined) {
          await check;
        } else {
          await Promise.race([
            check,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new ValidateTimeout()), this.validateTimeoutMs);
            }),
          ]);
        }
      } catch (err: any) {
        if (err instanceof ValidateTimeout) {
          return this.fail(
            toolName,
            rawArguments,
            "validation-unavailable",
            `[Validation Unavailable]: the existence check timed out after ${this.validateTimeoutMs}ms. This does not mean the resource is invalid; retry later.`
          );
        }
        return this.fail(toolName, rawArguments, "async-validation", `[Async Validation Failed]: ${err.message || String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }

    // Step 3: Safe Downstream Execution
    try {
      const output = await tool.execute(parseResult.data);
      this.consecutiveFailures.delete(toolName);
      this.onGateSuccess?.({ toolName, args: parseResult.data, data: output });
      return { success: true, data: output };
    } catch (err: any) {
      return this.fail(toolName, rawArguments, "execution", `[Execution Failed]: ${err.message || String(err)}`);
    }
  }

  private isCircuitOpen(toolName: string): boolean {
    if (this.maxConsecutiveFailures <= 0) return false;
    return (this.consecutiveFailures.get(toolName) ?? 0) >= this.maxConsecutiveFailures;
  }

  private fail(toolName: string, args: unknown, reason: GateFailureReason, error: string): GateResult {
    const consecutiveFailures =
      reason === "unregistered" ? 0 : (this.consecutiveFailures.get(toolName) ?? 0) + 1;

    if (reason !== "unregistered") {
      this.consecutiveFailures.set(toolName, consecutiveFailures);
    }

    this.onGateFailure?.({ toolName, args, error, reason, consecutiveFailures });
    return { success: false, error };
  }
}
