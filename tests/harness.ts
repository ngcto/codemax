import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionError, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import codemax from "../src/index.ts";

interface TestSessionOptions {
  builtinCodemode?: boolean;
  settings?: Parameters<typeof SettingsManager.inMemory>[0];
  tools?: string[];
  excludeTools?: string[];
}

export async function testSession(extra: InlineExtension[] = [], options: TestSessionOptions = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "codemax-test-"));
  const agentDir = join(cwd, "agent");
  const faux = fauxProvider({ tokensPerSecond: 0, models: [{ id: "test", contextWindow: 2000000 }] });
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, ...options.settings });
  const builtins: InlineExtension[] = options.builtinCodemode ? [{ name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true }] : [];
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: !options.builtinCodemode, noSkills: true, noContextFiles: true, extensionFactories: [codemax, ...extra, ...builtins] });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: faux.getModel(), settingsManager, tools: options.tools, excludeTools: options.excludeTools, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) });
  if (extensionsResult.errors.length) throw new Error(JSON.stringify(extensionsResult.errors));
  const runtimeErrors: ExtensionError[] = [];
  await session.bindExtensions({ mode: "print", onError: (error) => { runtimeErrors.push(error); } });
  async function script(code: string) {
    faux.setResponses([fauxAssistantMessage(fauxToolCall("codemode", { code }), { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
    await session.prompt("Run the requested test script.");
    const entry = [...session.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "codemode");
    if (entry?.type !== "message" || entry.message.role !== "toolResult") throw new Error("No codemode result.");
    return entry.message;
  }
  return { cwd, agentDir, faux, session, runtime, loader, settingsManager, extensionsResult, runtimeErrors, script };
}
