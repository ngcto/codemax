import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Capabilities } from "./capabilities.ts";
import { binding } from "./catalog.ts";
import { createCodemodeLoadout } from "./codemode.ts";
import { Configuration, parseConfig } from "./config.ts";
import { registerControl } from "./control.ts";
import { Delegates } from "./delegates.ts";
import { registerDelegateModelGuard } from "./delegate-providers.ts";
import { registerGuards } from "./guard.ts";
import { registerAsk } from "./interactions.ts";
import { registerHistory } from "./history.ts";
import { registerAutomations } from "./automations.ts";
import { learnedSkills, registerLearning } from "./learning.ts";
import { bundleRoot, skillRoot } from "./paths.ts";
import { registerScripts } from "./scripts.ts";
import { registerSettings } from "./settings.ts";
import { BranchState } from "./state.ts";
import { WebTools } from "./web/tools.ts";
import { registerWorkflows } from "./workflows.ts";

export const defaultVoice = "Speak plainly in short concrete sentences. Describe what matters for the user before implementation details. Cut filler and jargon. Keep relevant tradeoffs, evidence, and open decisions. Distinguish measured facts, inferences, and guesses. Claim only checks you ran.";

export default function codemax(pi: ExtensionAPI): void {
  const loadout = createCodemodeLoadout(pi);
  const state = new BranchState(pi);
  const config = new Configuration(state);
  const capabilities = new Capabilities(pi, state);
  const web = new WebTools(pi, config);
  registerWorkflows(pi, state, loadout.prepareLoadout);
  capabilities.register();
  registerLearning(pi, state);
  registerControl(pi);
  registerAsk(pi);
  registerHistory(pi);
  registerScripts(pi);
  const delegates = new Delegates(pi, config);
  delegates.register();
  registerAutomations(pi, delegates);
  registerSettings(pi, config, (ctx) => web.update(ctx));
  web.register();
  registerGuards(pi);
  registerDelegateModelGuard(pi);

  const activate = () => loadout.activate();
  const restore = async (ctx: ExtensionContext) => {
    state.restore(ctx);
    if (process.env.CODEMAX_SESSION_CONFIG && !state.value.configuration) config.session = parseConfig(JSON.parse(process.env.CODEMAX_SESSION_CONFIG));
    await capabilities.restore(ctx);
    await web.update(ctx);
    activate();
  };
  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("model_select", async (_event, ctx) => web.update(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", async () => web.clients.close());
  pi.on("resources_discover", async () => ({ skillPaths: [join(bundleRoot, "skills"), ...state.value.learned.map((entry) => entry.path)] }));
  pi.on("before_agent_start", async (event, ctx) => {
    activate();
    await web.update(ctx);
    const roots = [skillRoot("global", ctx.cwd), ...(ctx.isProjectTrusted() ? [skillRoot("project", ctx.cwd)] : [])];
    const learned = await learnedSkills(roots);
    const active = state.value.workflows.filter((run) => run.status === "active");
    const learnings = [...learned, ...state.value.learned];
    event.systemPromptOptions.sections.codemax = [
      "# codemax", defaultVoice, binding,
      "For nontrivial work, recall relevant learnings, read ultracode with workflow(action=read,name=ultracode), and start the matching playbook. Capture repro and final proof with verify, record skipped-step reasons, and finish the workflow or report the blocker. Trivial requests stay lightweight.",
      "UI task: read control-ui with workflow(action=read) to choose and load its driver on demand. Check control(action=status); if unready, request control(action=setup) approval before reading setup guidance. CLI/TUI task: read control-cli for repo-native harnesses, tmux, and PTY probes.",
      ...(process.env.CODEMAX_ALLOW_DELEGATION === "0" ? ["Implement the assigned slice directly."] : []),
      "Effective role settings: " + JSON.stringify(await config.read(ctx.cwd, ctx.isProjectTrusted())),
      ...(active.length ? ["Active workflow capsules: " + JSON.stringify(active.map((run) => ({ id: run.id, name: run.name, task: run.task, next: run.steps.find((step) => step.status === "pending" || step.status === "blocked") })))] : []),
      ...(learnings.length ? ["Learned skills: " + JSON.stringify(learnings.map(({ name, description, path }) => ({ name, description, path })))] : []),
    ].join("\n\n");
  });
}
