import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const dataSchema = Type.Unknown();

export function dataResult(value: unknown, usage?: Usage): AgentToolResult<unknown> {
  const serialized = JSON.stringify(value ?? null);
  return {
    content: [{ type: "text", text: serialized.length > 24000 ? serialized.slice(0, 24000) + "\n[Display truncated. Filter structuredContent in codemode.]" : serialized }],
    details: value,
    structuredContent: JSON.parse(serialized),
    ...(usage ? { usage } : {}),
  };
}

export async function boundedText(text: string, label: string, limit = 24000): Promise<{ text: string; artifact?: string; truncated: boolean }> {
  if (text.length <= limit) return { text, truncated: false };
  const dir = await mkdtemp(join(tmpdir(), "codemax-output-"));
  const artifact = join(dir, label.replace(/[^a-zA-Z0-9.-]/g, "_") + ".txt");
  await writeFile(artifact, text, { mode: 0o600 });
  return { text: text.slice(0, limit) + "\n[Full output at " + artifact + "]", artifact, truncated: true };
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

export function addUsage(total: Usage, usage: Usage): void {
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.totalTokens += usage.totalTokens;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += usage.cost[key];
}
