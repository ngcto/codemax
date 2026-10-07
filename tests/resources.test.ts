import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { catalog, instructions, resource } from "../src/catalog.ts";
import { bundleRoot, packageRoot } from "../src/paths.ts";
import { scriptSpecs } from "../src/scripts.ts";
import { runProcess } from "../src/process.ts";
import { testSession } from "./harness.ts";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

test("resource catalog preserves the upstream procedures and does not bundle voice as a skill", async () => {
  const entries = await catalog();
  assert.equal(entries.length, 81);
  assert.equal(entries.filter((entry) => entry.kind === "skill").length, 55);
  assert.equal(entries.filter((entry) => entry.kind === "playbook").length, 23);
  assert.equal(entries.filter((entry) => entry.kind === "automation").length, 3);
  for (const name of ["ultracode", "deslop", "control-cli", "control-ui", "browser-use", "cua-driver", "reflect", "arena", "swarm", "how", "why"]) assert.ok(entries.some((entry) => entry.name === name), name);
  assert.equal(entries.some((entry) => entry.name === "bro"), false);
});

test("bundled prose has renamed product references and no dangling local markdown links", async () => {
  const paths = (await walk(bundleRoot)).filter((path) => path.endsWith(".md"));
  const errors: string[] = [];
  for (const path of paths) {
    const body = await readFile(path, "utf8");
    assert.doesNotMatch(body, /pstack|poteto-mode|ucodemax/i);
    assert.doesNotMatch(body, new RegExp("(?<![\\w/.:~-])/(?:codemax|ultracode-help|setup-codemax|ultracode)(?![\\w/-])"), "Use native skill commands: " + path);
    assert.doesNotMatch(body, /(?:arm|under) \x60\/loop|codemax\/skills\/|scripts\/orch\/|scripts\/watch-pr\/|Pi's built-in (?:babysit|for authoring)/);
    for (const match of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!.split("#")[0]!.split(" ")[0]!;
      if (!target || /^(?:[a-z]+:|<|\$|\{)/i.test(target)) continue;
      try { await readFile(resolve(dirname(path), decodeURIComponent(target)), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EISDIR") continue; errors.push(path.replace(packageRoot, "") + " -> " + target); }
    }
  }
  assert.deepEqual(errors, []);
});

test("resources contain task instructions without shared prompt boilerplate", async () => {
  const paths = [
    ...(await walk(bundleRoot)).filter((path) => path.endsWith(".md")),
    ...(await walk(join(packageRoot, "src"))).filter((path) => path.endsWith(".ts")),
    join(packageRoot, "README.md"), join(packageRoot, "NOTICE.md"),
  ];
  for (const path of paths) {
    const body = await readFile(path, "utf8");
    assert.doesNotMatch(body, /## Pi execution contract|unprefixed|No prefix[.]|no dedicated slash commands|not command aliases|workflow labels|Cursor-only commands|resume-agent API|Automations editor|not bundled|no background scheduling API|no loop command is bundled|No separate voice skill|not a new automation harness/i, path);
  }
  const entry = await resource("deslop", "skill");
  assert.equal(await instructions(entry), "Resource directory: " + dirname(entry.path) + "\n\n" + await readFile(entry.path, "utf8"));
});

test("skill references use native Pi commands", async () => {
  const names = (await catalog()).filter((entry) => entry.kind === "skill").map((entry) => entry.name);
  const shortCommands = new RegExp("(?<![:/\\w])/(?:" + names.join("|") + ")(?![\\w/-])", "u");
  for (const path of (await walk(bundleRoot)).filter((path) => path.endsWith(".md"))) {
    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => !line.trimStart().startsWith("!["));
    for (const line of lines) assert.doesNotMatch(line, shortCommands, path);
  }
});

test("control-ui selects the driver by use case", async () => {
  const ui = await readFile(join(bundleRoot, "skills/control-ui/SKILL.md"), "utf8");
  const row = (useCase: string) => ui.split("\n").find((line) => line.startsWith("| " + useCase + " |")) ?? "";
  assert.match(ui, /^name: control-ui$/m);
  assert.doesNotMatch(ui, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(ui, /pty[.]openpty|playwright|remote-debugging-port/i);
  assert.ok(row("CLI/TUI test").includes("../control-cli/SKILL.md"));
  assert.ok(ui.includes("For CLI/TUI tests, follow control-cli directly."));
  assert.match(row("Public information"), /fetch/);
  assert.match(row("Web page interaction"), /browser-use/);
  assert.match(row("Native app"), /cua-driver/);
  assert.match(row("GUI-only"), /cua-driver/);
  assert.match(row("Browser chrome or OS dialogs"), /cua-driver/);
  assert.match(row("Electron renderer"), /browser-use/);
  assert.match(row("Electron menus or dialogs"), /cua-driver/);
  assert.ok(ui.includes("../browser-use/SKILL.md"));
  assert.ok(ui.includes("../cua-driver/SKILL.md"));
  assert.ok(ui.includes('action:"status"'));
  assert.ok(ui.includes('action:"setup"'));
  assert.ok(ui.includes("before reading setup guidance"));
  assert.ok(ui.includes("not permission to switch"));
  assert.ok(ui.includes("Observe fresh state, act once, then verify"));
});

test("control-cli preserves the original tmux and PTY skill", async () => {
  const body = await readFile(join(bundleRoot, "skills/control-cli/SKILL.md"), "utf8");
  assert.equal(createHash("sha256").update(body).digest("hex"), "13ac93e595bbda2000849bdb815d5f2ca03f7c2ca63788c8335f9212b9b422a2");
  for (const command of ["tmux new-session", "tmux capture-pane", "tmux send-keys", "tmux kill-session", "pty.openpty()", "NODE_OPTIONS="]) assert.ok(body.includes(command), command);
  assert.doesNotMatch(body, /browser-use|cua-driver|control-ui|Pi execution contract/);
});

test("deslop preserves cleanup scope, behavior, safety checks, and verification", async () => {
  const body = await readFile(join(bundleRoot, "skills/deslop/SKILL.md"), "utf8");
  assert.match(body, /^name: deslop$/m);
  assert.ok(body.includes("Extra comments"));
  assert.ok(body.includes("Defensive checks or try/catch"));
  assert.ok(body.includes("Casts to `any`"));
  assert.ok(body.includes("Deeply nested code"));
  assert.ok(body.includes("Do not assume `main` exists"));
  assert.ok(body.includes("Keep behavior unchanged"));
  assert.ok(body.includes("boundary validation, authorization, cancellation, and recovery"));
  assert.ok(body.includes("tools.verify"));
  assert.ok(body.includes("../unslop/SKILL.md"));
  assert.ok(body.includes("../no-comments/SKILL.md"));
});

test("every script tool's default help executes rather than importing an inert module", async () => {
  const h = await testSession();
  try {
    for (const name of Object.keys(scriptSpecs)) {
      const result = await h.script('return await tools.script({action:"run",name:' + JSON.stringify(name) + '});');
      assert.equal(result.isError, false, result.content.map((block) => block.type === "text" ? block.text : "").join(""));
      const text = result.content.map((block) => block.type === "text" ? block.text : "").join("");
      assert.match(text, /Usage:/);
      assert.match(text, /"exit_code":0/);
    }
  } finally { h.session.dispose(); }
});

test("multi-phase plan skeleton fills into a valid plan for the actual bundled validator", async () => {
  const body = await readFile(join(bundleRoot, "skills/ultracode/playbooks/multi-phase-plan.md"), "utf8");
  const template = body.split("\x60\x60\x60\x60markdown\n")[1]?.split("\n\x60\x60\x60\x60")[0];
  assert.ok(template);
  const plan = template.replaceAll("<execution playbook>", "autopilot-stack").replaceAll("<swarm workers model>", "inherit-parent").replace(/<[^<>]*>/g, "recorded-proof");
  const cwd = await mkdtemp(join(tmpdir(), "codemax-plan-test-"));
  const path = join(cwd, "plan.md");
  await writeFile(path, plan);
  const result = await runProcess(process.execPath, [scriptSpecs["check-plan"].path, path], { cwd });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 PR sections, 0 problems/);
});

test("worktree inventory handles spaces and preserves untracked work without Git metadata writes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-worktree-test-"));
  const repo = join(cwd, "repo with spaces");
  await runProcess("git", ["init", "-q", repo], { cwd });
  await writeFile(join(repo, "baseline.txt"), "original");
  await runProcess("git", ["add", "."], { cwd: repo });
  await runProcess("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "base"], { cwd: repo });
  const worktree = join(cwd, "candidate with spaces");
  await runProcess("git", ["worktree", "add", "--detach", worktree, "HEAD"], { cwd: repo });
  await writeFile(join(worktree, "unique.txt"), "keep me");
  const head = await readFile(join(repo, ".git", "HEAD"), "utf8");
  const result = await runProcess(process.execPath, [join(packageRoot, "scripts/ultracode/worktree-audit.mjs"), repo, "--json", "--no-github", "--base", "HEAD"], { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  const value = JSON.parse(result.stdout) as { rows: { path: string; dirty: string; bucket: string }[] };
  assert.equal(value.rows.length, 1);
  assert.equal(value.rows[0]?.path, worktree);
  assert.equal(value.rows[0]?.dirty, "scratch:1");
  assert.equal(value.rows[0]?.bucket, "hold-work");
  assert.equal(await readFile(join(repo, ".git", "HEAD"), "utf8"), head);
  assert.equal(await readFile(join(worktree, "unique.txt"), "utf8"), "keep me");
});
