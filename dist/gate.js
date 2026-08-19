const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
export class AgenticGate {
    tools = new Map();
    consecutiveFailures = new Map();
    maxConsecutiveFailures;
    onGateSuccess;
    onGateFailure;
    constructor(options = {}) {
        this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
        this.onGateSuccess = options.onGateSuccess;
        this.onGateFailure = options.onGateFailure;
    }
    /**
     * Registers a tool with its validation schema and execution function.
     */
    registerTool(tool) {
        this.tools.set(tool.name, tool);
    }
    /**
     * Manually resets the circuit breaker's failure count for a tool,
     * e.g. after an operator has addressed the underlying issue.
     */
    resetCircuit(toolName) {
        this.consecutiveFailures.delete(toolName);
    }
    /**
     * Intercepts raw tool arguments from an LLM, validates them against the registered Zod schema,
     * and executes the downstream tool only if validation succeeds.
     */
    async interceptAndExecute(toolName, rawArguments) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return this.fail(toolName, rawArguments, "unregistered", `Tool '${toolName}' is not registered in the validation engine.`);
        }
        // Step 0: Circuit Breaker — refuse to touch the schema/execute() once a tool
        // has failed too many times in a row, to stop runaway LLM retry loops.
        if (this.isCircuitOpen(toolName)) {
            const failures = this.consecutiveFailures.get(toolName) ?? 0;
            return this.fail(toolName, rawArguments, "circuit-open", `[Circuit Breaker OPEN]: Tool '${toolName}' has failed ${failures} consecutive times. Call gate.resetCircuit("${toolName}") once the underlying issue is resolved.`);
        }
        // Step 1: Intercept & Validate
        const parseResult = tool.schema.safeParse(rawArguments);
        if (!parseResult.success) {
            const formattedError = parseResult.error.errors
                .map((e) => `${e.path.join(".") || "parameter"}: ${e.message}`)
                .join("; ");
            return this.fail(toolName, rawArguments, "validation", `[Validation Gate Failed]: ${formattedError}`);
        }
        // Step 2: Safe Downstream Execution
        try {
            const output = await tool.execute(parseResult.data);
            this.consecutiveFailures.delete(toolName);
            this.onGateSuccess?.({ toolName, args: parseResult.data, data: output });
            return { success: true, data: output };
        }
        catch (err) {
            return this.fail(toolName, rawArguments, "execution", `[Execution Failed]: ${err.message || String(err)}`);
        }
    }
    isCircuitOpen(toolName) {
        if (this.maxConsecutiveFailures <= 0)
            return false;
        return (this.consecutiveFailures.get(toolName) ?? 0) >= this.maxConsecutiveFailures;
    }
    fail(toolName, args, reason, error) {
        const consecutiveFailures = reason === "unregistered" ? 0 : (this.consecutiveFailures.get(toolName) ?? 0) + 1;
        if (reason !== "unregistered") {
            this.consecutiveFailures.set(toolName, consecutiveFailures);
        }
        this.onGateFailure?.({ toolName, args, error, reason, consecutiveFailures });
        return { success: false, error };
    }
}
