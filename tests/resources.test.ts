import assert from "node:assert/strict";
import { readdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { catalog } from "../src/catalog.ts";
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

test("control guides choose tools by use case without importing harness setup", async () => {
  const ui = await readFile(join(bundleRoot, "skills/control-ui/SKILL.md"), "utf8");
  const cli = await readFile(join(bundleRoot, "skills/control-cli/SKILL.md"), "utf8");
  const row = (body: string, useCase: string) => body.split("\n").find((line) => line.startsWith("| " + useCase + " |")) ?? "";
  for (const [name, body] of [["control-ui", ui], ["control-cli", cli]] as const) {
    assert.match(body, new RegExp("^name: " + name + "$", "m"));
    assert.match(body, /^description: .+$/m);
    assert.ok(body.includes("| Use case | Prefer |"));
    assert.ok(body.includes("../browser-use/SKILL.md"));
    assert.ok(body.includes("../cua-driver/SKILL.md"));
    assert.doesNotMatch(body, /^disable-model-invocation: true$/m);
    assert.doesNotMatch(body, /tmux|pty[.]openpty|playwright|remote-debugging-port/i);
  }
  assert.match(row(ui, "Public information"), /fetch/);
  assert.match(row(ui, "Web page interaction"), /browser-use/);
  assert.match(row(ui, "Native app"), /cua-driver/);
  assert.match(row(ui, "GUI-only"), /cua-driver/);
  assert.match(row(ui, "Browser chrome or OS dialogs"), /cua-driver/);
  assert.match(row(ui, "Electron renderer"), /browser-use/);
  assert.match(row(ui, "Electron menus or dialogs"), /cua-driver/);
  assert.ok(ui.includes('action:"status"'));
  assert.ok(ui.includes('action:"setup"'));
  assert.ok(ui.includes("before reading setup guidance"));
  assert.ok(ui.includes("not permission to switch"));
  assert.ok(ui.includes("Observe fresh state, act once, then verify"));
  assert.match(row(cli, "Noninteractive command"), /verify/);
  assert.match(row(cli, "Native terminal"), /cua-driver/);
  assert.match(row(cli, "Browser-hosted terminal"), /browser-use/);
  assert.ok(cli.includes("../control-ui/SKILL.md"));
  assert.ok(cli.includes("Do not build or install a terminal harness"));
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
  assert.ok(body.includes("Bundled instructions are read-only"));
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
