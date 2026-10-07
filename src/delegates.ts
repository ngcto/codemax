import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { clampThinkingLevel, type Model, type Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { instructions, resource } from "./catalog.ts";
import { reservedTools } from "./capabilities.ts";
import { Configuration } from "./config.ts";
import { bashData, hostShell } from "./control.ts";
import { dataResult, dataSchema, emptyUsage, addUsage, boundedText } from "./output.ts";
import { delegateProviderLoadout } from "./delegate-providers.ts";
import { packageRoot, bundleRoot } from "./paths.ts";
import { runProcess, shellQuote } from "./process.ts";
import { enumSchema } from "./schema.ts";

export function modelFamily(id: string): string {
  const name = id.split("/").at(-1) ?? id;
  return name.startsWith("claude") ? "claude" : name.startsWith("grok") ? "grok" : name.startsWith("gpt") || /^o\d/.test(name) ? "gpt" : name.split("-")[0] ?? name;
}
export function resolveModel(value: string | undefined, available: Model<string>[], parent: Model<string> | undefined): Model<string> {
  if (!value || value === "auto" || value === "inherit-parent") {
    if (!parent) throw new Error("No parent model is selected.");
    return parent;
  }
  const matches = available.filter((model) => model.provider + "/" + model.id === value || model.id === value);
  if (!matches.length) throw new Error("Model unavailable: " + value + ". Inspect settings(action=models), then configure a verified model id.");
  if (matches.length > 1) throw new Error("Ambiguous model id: " + value + ". Select the exact provider/model id from settings(action=models).");
  return matches[0]!;
}
export function piInvocation(args: string[]): { command: string; args: string[] } {
  if (process.env.CODEMAX_PI_BINARY) return { command: process.env.CODEMAX_PI_BINARY, args };
  const current = process.argv[1];
  if (current && !current.startsWith("/$bunfs/") && existsSync(current) && /(?:pi-coding-agent|(?:^|\/)pi(?:\.js)?$)/.test(current)) return { command: process.execPath, args: [current, ...args] };
  if (!/^(node|bun)(?:\.exe)?$/.test(basename(process.execPath))) return { command: process.execPath, args };
  return { command: process.env.CODEMAX_PI_BINARY ?? "pi", args };
}

export class DelegateOutput {
  private pending = "";
  text = "";
  stopReason: string | undefined;
  error: string | undefined;
  readonly usage = emptyUsage();
  consume(chunk: string): void {
    this.pending += chunk;
    if (this.pending.length > 8 * 1024 * 1024) throw new Error("Delegate emitted an oversized JSONL record.");
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.line(line);
  }
  finish(): void { if (this.pending.trim()) this.line(this.pending); this.pending = ""; }
  private line(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    const event = value as { type?: string; message?: { role?: string; content?: { type: string; text?: string }[]; stopReason?: string; errorMessage?: string; usage?: Usage } };
    if (event.type !== "message_end" || !event.message) return;
    const message = event.message;
    if (["assistant", "toolResult"].includes(message.role ?? "") && message.usage) addUsage(this.usage, message.usage);
    if (message.role !== "assistant") return;
    this.text = (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    this.stopReason = message.stopReason;
    this.error = message.errorMessage;
  }
}

export class Limiter {
  private running = 0;
  private queue: (() => void)[] = [];
  async run<T>(limit: number, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    while (this.running >= limit) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const abort = () => { this.queue = this.queue.filter((x) => x !== ready); reject(new Error("Delegate canceled before startup.")); };
        this.queue.push(ready);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    signal?.throwIfAborted();
    this.running++;
    try { return await fn(); } finally { this.running--; this.queue.shift()?.(); }
  }
}
export interface DelegateTask { task: string; model?: string; role?: string; skill?: string; agent?: "ultracode-agent" | "comment-sicko"; readOnly?: boolean; isolate?: boolean; allowDelegation?: boolean; timeout?: number; }
export interface DelegateResult { task: string; model: string; role: string; status: "complete" | "failed" | "aborted" | "timeout"; output: string; artifact?: string; transcript: string; stderr: string; worktree?: string; usage: Usage; }
export const panelRoles = { arena: "arena runners", architect: "architect runners", swarm: "swarm workers", interrogate: "interrogate reviewers", how: "how explorer", why: "why investigators", reflect: "reflect judgment, divergent, synthesizer" } as const;

export class Delegates {
  private limiter = new Limiter();
  constructor(private readonly pi: ExtensionAPI, private readonly config: Configuration) {}
  async run(task: DelegateTask, ctx: ExtensionToolContext, signal?: AbortSignal): Promise<DelegateResult> {
    if (process.env.CODEMAX_ALLOW_DELEGATION === "0") throw new Error("This worker has no nested delegation grant. Own the assigned slice directly.");
    if (process.env.CODEMAX_READONLY === "1" && task.readOnly === false) throw new Error("Read-only delegates cannot grant writes to nested workers.");
    const depth = Number(process.env.CODEMAX_DELEGATE_DEPTH ?? "0");
    if (!Number.isFinite(depth) || depth >= 3) throw new Error("Delegate depth limit reached. Own this slice directly.");
    const config = await this.config.read(ctx.cwd, ctx.isProjectTrusted());
    const role = task.role ?? "swarm workers";
    const configured = config.roles?.[role];
    const model = resolveModel(task.model ?? (Array.isArray(configured) ? configured[0] : configured), ctx.modelRegistry.getAvailable(), ctx.model);
    const readOnly = task.readOnly ?? true;
    if (!readOnly && !task.isolate) throw new Error("Writable delegates require isolate=true so independent workers never share a checkout.");
    return this.limiter.run(config.maxDelegates ?? 4, signal, async () => {
      const provider = await delegateProviderLoadout(this.pi, ctx, model, signal);
      const dir = await mkdtemp(join(tmpdir(), "codemax-delegate-"));
      let cwd = ctx.cwd, worktree: string | undefined;
      if (task.isolate) {
        const dirty = await bashData(ctx, "git status --porcelain", signal);
        if (dirty.exit_code !== 0) throw new Error("Isolated delegates require a Git repository.");
        if (dirty.output.trim()) throw new Error("Commit the candidate baseline before creating isolated delegates. Uncommitted parent changes are not silently omitted.");
        worktree = join(dir, "checkout");
        const added = await bashData(ctx, "git worktree add --detach " + shellQuote(worktree, hostShell(ctx)) + " HEAD", signal, 60);
        if (added.exit_code !== 0) throw new Error("Could not create delegate worktree: " + added.output);
        cwd = worktree;
      }
      const prompt = join(dir, "brief.md");
      const policy = join(dir, "policy.md");
      const extra = task.skill ? await instructions(await resource(task.skill)) : "";
      const profile = task.agent ? await readFile(join(bundleRoot, "agents", task.agent + ".md"), "utf8") : "";
      const posture = task.agent === "ultracode-agent" && task.skill !== "ultracode" ? await instructions(await resource("ultracode", "skill")) : "";
      const body = ["# Delegate contract", "You own only this assigned slice. Do not post to chat/tickets, push, merge, deploy, or modify bundled instructions. Return observations with paths, commands, evidence, uncertainties, and an actionable result. A self-report is not verification.", task.allowDelegation ? "You may spawn bounded nested workers only for the brief's assigned scope. Depth and concurrency caps still apply." : "Nested delegation is forbidden. Own the assigned implementation directly when a playbook ordinarily delegates it. Do not wait or stand by for an agent you cannot spawn.", readOnly ? "Read-only investigation. Do not change files or external state." : "Work in the assigned isolated checkout. Keep all file writes inside it. Commit verified changes locally and report commit hashes. Do not push or merge.", profile, posture, extra].filter(Boolean).join("\n\n");
      await Promise.all([writeFile(policy, body, { mode: 0o600 }), writeFile(prompt, task.task, { mode: 0o600 })]);
      const shell = hostShell(ctx);
      const tools = [...reservedTools].filter((name) => !["bash", "powershell", ...(readOnly ? ["edit", "write"] : [])].includes(name));
      tools.push(shell);
      const args = ["--mode", "json", "--print", "--no-session", "--no-extensions", ...provider.paths.flatMap((path) => ["--extension", path]), "--extension", "builtin:mcp", "--extension", join(packageRoot, "src", "index.ts"), "--skill", join(packageRoot, "resources", "skills"), "--model", model.provider + "/" + model.id, "--tools", tools.join(","), "--append-system-prompt", policy];
      if (ctx.isProjectTrusted()) args.push("--approve"); else args.push("--no-approve");
      const requestedEffort = { small: "medium", medium: "high", large: "xhigh", unlimited: "max" }[config.budget ?? "medium"] as "medium" | "high" | "xhigh" | "max";
      const effort = clampThinkingLevel(model, requestedEffort);
      args.push("--thinking", effort, "@" + prompt);
      const invocation = piInvocation(args);
      const output = new DelegateOutput();
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SLACK|WEBHOOK|SENDER_KEY|BOT_TOKEN/i.test(key)));
      const result = await runProcess(invocation.command, invocation.args, { cwd, signal, timeoutMs: (task.timeout ?? 900) * 1000, env: { ...env, CODEMAX_DELEGATE_DEPTH: String(depth + 1), CODEMAX_READONLY: readOnly ? "1" : "0", CODEMAX_ALLOW_DELEGATION: task.allowDelegation ? "1" : "0", CODEMAX_WORKTREE: worktree, CODEMAX_PARENT_CWD: resolve(ctx.cwd), CODEMAX_SESSION_CONFIG: JSON.stringify(config), CODEMAX_PROVIDER_EXTENSIONS: provider.environment, CODEMAX_DELEGATE_MODEL: JSON.stringify({ provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl, extension: provider.paths.length > 0 }) }, onStdout: (chunk) => output.consume(chunk) });
      output.finish();
      const status = result.aborted ? "aborted" : result.timedOut ? "timeout" : result.exitCode === 0 && output.stopReason === "stop" && !output.error ? "complete" : "failed";
      const bounded = await boundedText(output.text || output.error || result.stderr || "No final assistant output.", "delegate");
      return { task: task.task, model: model.provider + "/" + model.id, role, status, output: bounded.text, artifact: bounded.artifact, transcript: result.stdoutPath, stderr: result.stderr.slice(-12000), worktree, usage: output.usage };
    });
  }
  register(): void {
    const taskSchema = Type.Object({ task: Type.String({ minLength: 1 }), model: Type.Optional(Type.String()), role: Type.Optional(Type.String()), skill: Type.Optional(Type.String()), agent: Type.Optional(enumSchema(["ultracode-agent", "comment-sicko"])), readOnly: Type.Optional(Type.Boolean()), isolate: Type.Optional(Type.Boolean()), allowDelegation: Type.Optional(Type.Boolean()), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 14400 })) });
    this.pi.registerTool({ name: "delegate", label: "Delegate", exposure: "codemode", description: "Run a fresh Pi agent with isolated context, codemode-only tools, verified model selection, cancellation, bounded output and transcript artifact. Writable workers require an isolated clean Git worktree; results are never auto-merged. Batch independent slices with Promise.allSettled, chain by passing prior artifacts, or use panel for bakeoffs/review.", parameters: taskSchema, outputSchema: dataSchema, execute: async (_id, task, signal, _update, ctx) => { const result = await this.run(task, ctx, signal); return { ...dataResult(result, result.usage), ...(result.status === "complete" ? {} : { isError: true }) }; } });
    this.pi.registerTool({
      name: "panel", label: "Panel", exposure: "codemode", description: "Parallel arena, swarm, architect, interrogate, how, why or reflection panel. Candidates have fresh contexts and explicit models. Writable candidates get disjoint worktrees. Returns every result/failure and optionally an independent cross-model judge; never grafts or merges a candidate automatically.",
      parameters: Type.Object({ mode: enumSchema(["arena", "swarm", "architect", "interrogate", "how", "why", "reflect"]), tasks: Type.Array(taskSchema, { minItems: 1, maxItems: 8 }), rubric: Type.Optional(Type.String()), judge: Type.Optional(Type.Boolean()), judgeModel: Type.Optional(Type.String()) }), outputSchema: dataSchema,
      execute: async (_id, params, signal, _update, ctx) => {
        if (params.judge && !params.rubric?.trim()) throw new Error("Judged panels require a rubric written before inspecting candidates.");
        if (params.judgeModel) resolveModel(params.judgeModel, ctx.modelRegistry.getAvailable(), ctx.model);
        const config = await this.config.read(ctx.cwd, ctx.isProjectTrusted());
        const settled = await Promise.allSettled(params.tasks.map((task, index) => {
          const role = task.role ?? panelRoles[params.mode];
          const choices = config.roles?.[role];
          const model = task.model ?? (Array.isArray(choices) ? choices[index % choices.length] : choices);
          return this.run({ ...task, model, skill: task.skill, role }, ctx, signal);
        }));
        const results = settled.map((entry, index) => entry.status === "fulfilled" ? entry.value : { task: params.tasks[index]?.task, status: "failed", error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) });
        const usage = emptyUsage();
        for (const entry of settled) if (entry.status === "fulfilled") addUsage(usage, entry.value.usage);
        let judge: DelegateResult | undefined;
        if (params.judge) {
          const available = ctx.modelRegistry.getAvailable();
          const families = new Set(settled.filter((entry) => entry.status === "fulfilled").map((entry) => modelFamily(entry.value.model)));
          const pool = config.roles?.["arena cross-judge pool"];
          const preferred = (Array.isArray(pool) ? pool : pool ? [pool] : []).map((id) => resolveModel(id, available, ctx.model));
          const other = preferred.find((model) => !families.has(modelFamily(model.id))) ?? preferred[0];
          judge = await this.run({ task: "Judge these independently completed candidate artifacts against the rubric. Read artifacts directly and verify claims. Prefer the simplest correct result; distinguish PASS, FAIL, and INCONCLUSIVE. No edits.\n\nRubric:\n" + params.rubric + "\n\nCandidates:\n" + JSON.stringify(results), model: params.judgeModel ?? (other ? other.provider + "/" + other.id : undefined), readOnly: true, role: "arena cross-judge pool" }, ctx, signal);
          addUsage(usage, judge.usage);
        }
        return dataResult({ mode: params.mode, results, judge, independentReview: judge?.status === "complete", crossModelReview: judge?.status === "complete" && settled.some((entry) => entry.status === "fulfilled" && entry.value.status === "complete") && settled.every((entry) => entry.status !== "fulfilled" || entry.value.status !== "complete" || modelFamily(entry.value.model) !== modelFamily(judge!.model)), next: "The lead must inspect diffs, rerun proof, and explicitly choose/graft a candidate. Failures and agreement are not proof." }, usage);
      },
    });
  }
}
