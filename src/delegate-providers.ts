import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { DefaultPackageManager, getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";

type ProviderExtensions = Record<string, string[]>;
export interface DelegateProviderLoadout { paths: string[]; environment: string | undefined; }

function configuredExtensions(cwd: string): ProviderExtensions {
  const value = process.env.CODEMAX_PROVIDER_EXTENSIONS;
  if (!value) return Object.create(null) as ProviderExtensions;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("CODEMAX_PROVIDER_EXTENSIONS must be a JSON object mapping provider IDs to local extension files."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CODEMAX_PROVIDER_EXTENSIONS must be a JSON object.");
  const result = Object.create(null) as ProviderExtensions;
  for (const [id, entry] of Object.entries(parsed)) {
    const paths = Array.isArray(entry) ? entry : [entry];
    if (!id.trim() || !paths.length || paths.length > 8 || paths.some((path) => typeof path !== "string" || !path.trim())) throw new Error("CODEMAX_PROVIDER_EXTENSIONS entries require one to eight local extension paths.");
    result[id] = paths.map((path: string) => resolve(cwd, path));
  }
  return result;
}

async function extensionFile(path: string): Promise<string> {
  const file = await realpath(path).catch(() => { throw new Error("Delegate provider extension is missing: " + path); });
  if (!(await stat(file)).isFile() || !/\.[cm]?[jt]s$/.test(file)) throw new Error("Delegate provider extension must be a local JavaScript or TypeScript file: " + path);
  return file;
}

function namesProvider(source: string, id: string, namedResource: boolean): boolean {
  // Source hints are not registration provenance. Imported/dynamic cases can use an explicit map.
  const tokens = (source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[\w$]+|[^\s]/g) ?? []).filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
  const literal = (token: string | undefined) => token === JSON.stringify(id) || token === "'" + id + "'" || token === "`" + id + "`";
  const constants = new Set<string>();
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === "const" && tokens[i + 2] === "=" && literal(tokens[i + 3])) constants.add(tokens[i + 1]!);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "." || tokens[i + 1] !== "registerProvider" || tokens[i + 2] !== "(") continue;
    const argument = tokens[i + 3];
    if (namedResource || literal(argument) || (argument && constants.has(argument))) return true;
    if (argument === "{" && tokens[i + 4] === "id" && tokens[i + 5] === ":" && literal(tokens[i + 6])) return true;
  }
  return false;
}

export function registerDelegateModelGuard(pi: ExtensionAPI): void {
  if (!process.env.CODEMAX_DELEGATE_DEPTH || !process.env.CODEMAX_DELEGATE_MODEL) return;
  type Contract = Pick<Model<string>, "provider" | "id" | "api"> & { baseUrl?: string; extension?: boolean };
  let expected: Contract | undefined;
  try {
    const value = JSON.parse(process.env.CODEMAX_DELEGATE_MODEL) as Partial<Contract> | null;
    if (value && [value.provider, value.id, value.api].every((entry) => typeof entry === "string" && entry.trim()) && (value.baseUrl === undefined || typeof value.baseUrl === "string") && (value.extension === undefined || typeof value.extension === "boolean")) expected = value as Contract;
  } catch { /* Invalid contracts are blocked once the worker context is available. */ }
  pi.on("before_agent_start", async (_event, ctx) => {
    const selected = ctx.model;
    const registered = expected && ctx.modelRegistry.find(expected.provider, expected.id);
    const extension = expected && (ctx.modelRegistry.getRegisteredProviderConfig(expected.provider) || ctx.modelRegistry.getRegisteredNativeProvider(expected.provider));
    if (expected && selected && registered && selected.provider === expected.provider && selected.id === expected.id && selected.api === expected.api && registered.api === expected.api && (!expected.baseUrl || (selected.baseUrl === expected.baseUrl && registered.baseUrl === expected.baseUrl)) && (!expected.extension || extension)) return;
    const message = expected ? "Delegate requested exact model " + expected.provider + "/" + expected.id + " (" + expected.api + "), but the worker loaded a different model, API, endpoint, or provider extension." : "Invalid delegate model contract.";
    // Event errors alone are reported and execution continues. Block provider dispatch too.
    const provider = selected && ctx.modelRegistry.getProvider(selected.provider);
    if (provider) ctx.modelRegistry.registerProvider({ ...provider, stream() { throw new Error(message); }, streamSimple() { throw new Error(message); } });
    throw new Error(message);
  });
}

// Pi exposes provider registrations and resource provenance, but not their association.
// Inspect already-loaded/configured local sources; never execute a candidate to discover it.
export async function delegateProviderLoadout(pi: ExtensionAPI, ctx: ExtensionToolContext, model: Model<string>, signal?: AbortSignal): Promise<DelegateProviderLoadout> {
  signal?.throwIfAborted();
  const configured = configuredExtensions(ctx.cwd);
  const explicit = configured[model.provider];
  if (explicit) {
    const paths = [...new Set(await Promise.all(explicit.map(extensionFile)))];
    signal?.throwIfAborted();
    configured[model.provider] = paths;
    return { paths, environment: JSON.stringify(configured) };
  }
  const registry = ctx.modelRegistry;
  if (!registry.getRegisteredProviderConfig?.(model.provider) && !registry.getRegisteredNativeProvider?.(model.provider)) {
    return { paths: [], environment: Object.keys(configured).length ? JSON.stringify(configured) : undefined };
  }
  const trusted = ctx.isProjectTrusted();
  const candidates = new Map<string, boolean>();
  const add = (path: string, scope?: string, name?: string) => {
    if (isAbsolute(path) && (scope !== "project" || trusted)) candidates.set(path, candidates.get(path) === true || name === model.provider || name?.startsWith(model.provider + "-") === true);
  };
  for (const command of pi.getCommands?.() ?? []) if (command.source === "extension") add(command.sourceInfo.path, command.sourceInfo.scope, command.name);
  for (const tool of pi.getAllTools?.() ?? []) add(tool.sourceInfo.path, tool.sourceInfo.scope, tool.name);
  const inspect = async (): Promise<string[]> => {
    const paths: string[] = [];
    for (const [path, namedResource] of candidates) {
      signal?.throwIfAborted();
      try {
        const file = await extensionFile(path);
        if ((await stat(file)).size <= 512 * 1024 && namesProvider(await readFile(file, "utf8"), model.provider, namedResource)) paths.push(file);
      } catch { signal?.throwIfAborted(); }
    }
    return [...new Set(paths)];
  };
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: trusted });
  const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir, settingsManager });
  const resources = await manager.resolve(async () => "skip");
  for (const resource of resources.extensions) if (resource.enabled) add(resource.path, resource.metadata.scope);
  const matches = await inspect();
  signal?.throwIfAborted();
  if (matches.length !== 1) throw new Error((matches.length ? "Ambiguous delegate provider extension for " : "Cannot locate the delegate provider extension for ") + model.provider + ". Set CODEMAX_PROVIDER_EXTENSIONS to a JSON mapping of that provider ID to its approved local extension file.");
  configured[model.provider] = matches;
  return { paths: matches, environment: JSON.stringify(configured) };
}
