import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
  elapsedMs: number;
  aborted: boolean;
  timedOut: boolean;
  truncated: boolean;
}
export interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
}

export function shellQuote(value: string, shell: "bash" | "powershell" = process.platform === "win32" ? "powershell" : "bash"): string {
  return shell === "powershell" ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export async function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "codemax-run-"));
  const stdoutPath = join(dir, "stdout.txt"), stderrPath = join(dir, "stderr.txt");
  const out = createWriteStream(stdoutPath, { mode: 0o600 }), err = createWriteStream(stderrPath, { mode: 0o600 });
  const writes = Promise.all([finished(out), finished(err)]);
  void writes.catch(() => {});
  const start = performance.now();
  let stdout = "", stderr = "", truncated = false, aborted = false, timedOut = false;
  let hardKill: NodeJS.Timeout | undefined;
  let closed = false;
  let observerError: unknown;
  const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
  const proc = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  const kill = (signal: NodeJS.Signals) => {
    if (closed) return;
    try { if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal); else proc.kill(signal); } catch {}
  };
  const stop = () => {
    kill("SIGTERM");
    hardKill ??= setTimeout(() => kill("SIGKILL"), 1000);
    hardKill.unref();
  };
  const retain = (current: string, chunk: string) => {
    const value = current + chunk;
    if (value.length <= 1024 * 1024) return value;
    truncated = true;
    return value.slice(0, 512 * 1024) + "\n[Output omitted]\n" + value.slice(-512 * 1024);
  };
  proc.stdout.on("data", (chunk: Buffer) => {
    const value = stdoutDecoder.write(chunk);
    stdout = retain(stdout, value);
    try { options.onStdout?.(value); } catch (error) { observerError = error; stop(); }
  });
  proc.stderr.on("data", (chunk: Buffer) => { stderr = retain(stderr, stderrDecoder.write(chunk)); });
  proc.stdout.on("end", () => { const tail = stdoutDecoder.end(); stdout = retain(stdout, tail); if (tail) { try { options.onStdout?.(tail); } catch (error) { observerError = error; } } });
  proc.stderr.on("end", () => { stderr = retain(stderr, stderrDecoder.end()); });
  proc.stdout.pipe(out); proc.stderr.pipe(err);
  out.on("error", () => stop()); err.on("error", () => stop());
  proc.stdin.on("error", () => {}); proc.stdin.end(options.input);
  const abort = () => { aborted = true; stop(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = options.timeoutMs ? setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs) : undefined;
  timer?.unref();
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", (code) => { closed = true; resolve(code); });
    });
    await writes;
    if (observerError) throw observerError;
    return { exitCode, stdout, stderr, stdoutPath, stderrPath, elapsedMs: performance.now() - start, aborted, timedOut, truncated };
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill);
    options.signal?.removeEventListener("abort", abort);
    out.end(); err.end();
    await writes.catch(() => {});
  }
}

export function runShell(command: string, options: ProcessOptions): Promise<ProcessResult> {
  return process.platform === "win32"
    ? runProcess("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], options)
    : runProcess("bash", ["-lc", command], options);
}
