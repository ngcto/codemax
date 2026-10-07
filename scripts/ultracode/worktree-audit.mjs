#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
async function command(program, args, cwd) {
  try { return (await exec(program, args, { cwd, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
  catch { return undefined; }
}
export function parseWorktrees(text) {
  const rows = [];
  let current;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) { current = { path: line.slice(9), head: "", branch: "" }; rows.push(current); }
    else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
  }
  return rows;
}
async function sessionFiles(root, depth = 0) {
  if (depth > 2) return [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const groups = await Promise.all(entries.map((entry) => entry.isDirectory() ? sessionFiles(join(root, entry.name), depth + 1) : entry.isFile() && entry.name.endsWith(".jsonl") ? [join(root, entry.name)] : []));
  return groups.flat();
}
async function recentChats(root, worktrees) {
  const latest = new Map();
  const files = await sessionFiles(root);
  for (const path of files.slice(0, 1000)) {
    let info, body;
    try { info = await stat(path); if (info.size > 8 * 1024 * 1024) continue; body = await readFile(path, "utf8"); } catch { continue; }
    for (const worktree of worktrees) if ((body.includes(JSON.stringify(worktree.path)) || body.includes(worktree.path + "/")) && info.mtimeMs > (latest.get(worktree.path)?.modified ?? 0)) latest.set(worktree.path, { path, modified: info.mtimeMs });
  }
  return latest;
}
export async function auditWorktrees(repo, options = {}) {
  const text = await command("git", ["worktree", "list", "--porcelain"], repo);
  if (text === undefined) throw new Error("Not a Git repository.");
  const worktrees = parseWorktrees(text);
  const main = worktrees[0]?.path;
  const sessionRoot = options.sessionRoot ?? process.env.PI_CODING_AGENT_SESSION_DIR ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
  const chats = await recentChats(sessionRoot, worktrees);
  const defaultRef = await command("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repo);
  const mainRef = options.base ?? defaultRef ?? "origin/main";
  const raw = options.github === false ? undefined : await command("gh", ["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName"], repo);
  let prs = [];
  try { prs = JSON.parse(raw ?? "[]"); } catch {}
  const now = Date.now();
  const rows = [];
  for (const worktree of worktrees) {
    if (worktree.path === main) continue;
    const [porcelain, ancestor, time, size, remoteHead] = await Promise.all([
      command("git", ["status", "--porcelain"], worktree.path),
      command("git", ["merge-base", "--is-ancestor", worktree.head, mainRef], repo),
      command("git", ["log", "-1", "--format=%ct", "HEAD"], worktree.path),
      command("du", ["-sk", worktree.path], repo),
      worktree.branch ? command("git", ["rev-parse", "--verify", "refs/remotes/origin/" + worktree.branch], repo) : Promise.resolve(undefined),
    ]);
    const dirtyLines = porcelain?.split("\n").filter(Boolean) ?? [];
    const tracked = dirtyLines.filter((line) => !line.startsWith("??")).length;
    const dirty = porcelain === undefined ? "unknown" : tracked ? "wip:" + tracked : dirtyLines.length ? "scratch:" + dirtyLines.length : "clean";
    const pr = prs.find((item) => item.headRefName === worktree.branch);
    const merged = ancestor !== undefined || pr?.state === "MERGED";
    const chat = chats.get(worktree.path);
    const recent = chat && now - chat.modified <= 4 * 86400000;
    const bucket = dirty !== "clean" ? "hold-work" : pr?.state === "OPEN" ? "hold-open-pr" : recent ? "verify-recent-chat" : merged ? "candidate-review" : "review";
    rows.push({ ...worktree, sizeKiB: Number.parseInt(size ?? "") || null, ageDays: time ? Math.floor((now / 1000 - Number(time)) / 86400) : null, merged, base: mainRef, dirty, remote: !worktree.branch ? "detached" : !remoteHead ? "no-remote" : remoteHead === worktree.head ? "pushed" : "different", pr: pr ? "#" + pr.number + "/" + pr.state : null, lastChat: chat?.path, lastChatAt: chat ? new Date(chat.modified).toISOString() : null, bucket });
  }
  return { repo: resolve(repo), rows: rows.sort((a, b) => (b.sizeKiB ?? 0) - (a.sizeKiB ?? 0)), warnings: ["No fetch or Git metadata mutation was performed. Merge refs and PR history may be stale or unavailable.", "Session modification time is not liveness. Confirm active sessions, retained commits, ignored files and user approval before any deletion."] };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("Usage: worktree-audit.mjs [repo-path] [--json] [--base <ref>] [--sessions <dir>] [--no-github]\nRead-only inventory. Does not fetch, change Git metadata, or delete files."); return; }
  const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const repo = args[0] && !args[0].startsWith("-") ? args[0] : process.cwd();
  const result = await auditWorktrees(repo, { base: value("--base"), sessionRoot: value("--sessions"), github: !args.includes("--no-github") });
  if (args.includes("--json")) console.log(JSON.stringify(result));
  else { console.log("KIB\tAGE_DAYS\tMERGED\tDIRTY\tREMOTE\tPR\tBUCKET\tWORKTREE"); for (const row of result.rows) console.log([row.sizeKiB ?? "?", row.ageDays ?? "?", row.merged ? "yes" : "no", row.dirty, row.remote, row.pr ?? "-", row.bucket, row.path].join("\t")); for (const warning of result.warnings) console.error(warning); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
