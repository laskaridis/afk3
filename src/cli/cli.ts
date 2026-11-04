import { AgentRegistry } from "../agents/registry.js";
import { ConsoleReporter } from "../reporter/console-reporter.js";
import { SessionExecutorFactory } from "../session/session-executor-factory.js";
import { WorkflowExecutor } from "../workflow/workflow-executor.js";
import { EXIT_CODES, exitCodeFor } from "./exit-codes.js";
import { resolvePrompt } from "./launch-prompt.js";
import { parseOptions } from "./options.js";

async function readAllStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk as string;
  return text;
}

/** Parses options, resolves the launch prompt, wires and runs the workflow, and returns the process exit code. */
export class CLI {
  private readonly registry = new AgentRegistry();

  async run(argv: string[]): Promise<number> {
    const parsed = parseOptions(argv, this.registry);
    if (parsed.kind === "exit") return parsed.code;
    const { options } = parsed;

    const resolved = await resolvePrompt({
      positional: options.positional,
      promptFile: options.promptFile,
      stdinIsTTY: Boolean(process.stdin.isTTY),
      readStdin: readAllStdin,
    });
    if (!resolved.ok) {
      process.stderr.write(`[afk] input error: ${resolved.message}\n`);
      return EXIT_CODES.inputError;
    }

    const interruption = new AbortController();
    // Repeated signals are absorbed: the first one already stops the run.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => interruption.abort());

    const graceMs = Number(process.env.AFK_TERMINATION_GRACE_MS) || undefined;
    const sessionFactory = new SessionExecutorFactory(interruption.signal, options.sessionTimeout, graceMs);
    const workflowOptions = {
      adapter: this.registry.get(options.agent)!,
      model: options.model,
      effort: options.reasoningEffort,
      maxIterations: options.maxIterations,
      sessionTimeoutSeconds: options.sessionTimeout,
      cwd: options.cwd,
    };
    const launchPrompt = { text: resolved.prompt };
    const workflow = new WorkflowExecutor(workflowOptions, launchPrompt, sessionFactory);
    workflow.subscribe(new ConsoleReporter(process.stderr));
    return exitCodeFor(await workflow.run());
  }
}
