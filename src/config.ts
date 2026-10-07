import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { assertProjectScope, stateRoot, type Scope } from "./paths.ts";
import { readJson, updateJson } from "./storage.ts";
import { enumSchema } from "./schema.ts";
import type { BranchState } from "./state.ts";

export const providerIds = ["exa", "parallel"] as const;
export type WebProviderId = typeof providerIds[number];
const roleValue = Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1, maxItems: 8 })]);
export const configSchema = Type.Object({
  roles: Type.Optional(Type.Record(Type.String(), roleValue)),
  budget: Type.Optional(Type.Union([Type.Literal("small"), Type.Literal("medium"), Type.Literal("large"), Type.Literal("unlimited")])),
  web: Type.Optional(Type.Object({
    default: Type.Optional(enumSchema([...providerIds, "native", "auto"])),
    enabled: Type.Optional(Type.Array(enumSchema(providerIds))),
    native: Type.Optional(Type.Boolean()),
    nativeInConversation: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false })),
  maxDelegates: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
}, { additionalProperties: false });
export type Config = Static<typeof configSchema>;
export const defaults: Config = { roles: {}, budget: "medium", web: { default: "auto", enabled: [...providerIds], native: true, nativeInConversation: true }, maxDelegates: 4 };

export function parseConfig(input: unknown): Config {
  if (input === undefined) return {};
  if (!Value.Check(configSchema, input)) throw new Error("Invalid codemax configuration. Unknown keys and invalid values are rejected.");
  return input;
}
export function mergeConfig(base: Config, overlay: Config): Config {
  return { ...base, ...overlay, roles: { ...base.roles, ...overlay.roles }, web: { ...base.web, ...overlay.web } };
}

export class Configuration {
  private overrides: Config = {};
  constructor(private readonly state?: BranchState) {}
  get session(): Config { return this.state?.value.configuration ?? this.overrides; }
  set session(value: Config) {
    if (this.state) this.state.commit((s) => { s.configuration = value; });
    else this.overrides = value;
  }
  async read(cwd: string, trusted: boolean): Promise<Config> {
    const global = parseConfig(await readJson(join(stateRoot("global", cwd), "config.json")));
    const project = trusted ? parseConfig(await readJson(join(stateRoot("project", cwd), "config.json"))) : {};
    return mergeConfig(mergeConfig(mergeConfig(defaults, global), project), parseConfig(this.session));
  }
  async save(scope: Scope, cwd: string, trusted: boolean, patch: Config): Promise<void> {
    assertProjectScope(scope, trusted);
    parseConfig(patch);
    if (scope === "session") this.session = mergeConfig(this.session, patch);
    else await updateJson(join(stateRoot(scope, cwd), "config.json"), parseConfig, (current) => mergeConfig(current, patch));
  }
}
