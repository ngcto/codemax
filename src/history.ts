import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { dataResult, dataSchema } from "./output.ts";
import { enumSchema } from "./schema.ts";
import { canonicalPath } from "./paths.ts";

export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const value = message as { content?: unknown };
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content.filter((block): block is { type: "text"; text: string } => block && typeof block === "object" && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
}

export async function transcriptSlice(path: string, query: string, includeTools: boolean, limit: number, signal?: AbortSignal): Promise<{ entry: string; role: string; text: string }[]> {
  if ((await stat(path)).size > 50 * 1024 * 1024) throw new Error("Transcript exceeds bounded scan size. Use a targeted file read or delegate with the exact path.");
  const stream = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const entries = new Map<string, { id: string; parentId?: string | null; message?: { role?: string; content?: unknown } }>();
  let last: string | undefined;
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      let entry: { id?: string; type?: string; parentId?: string | null; message?: { role?: string; content?: unknown } };
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.id && entry.type !== "session") { entries.set(entry.id, { ...entry, id: entry.id }); last = entry.id; }
    }
  } finally { lines.close(); stream.destroy(); }
  const result: { entry: string; role: string; text: string }[] = [];
  const visited = new Set<string>();
  while (last && !visited.has(last)) {
    visited.add(last);
    const entry = entries.get(last);
    if (!entry) break;
    const role = entry.message?.role;
    if (role === "user" || role === "assistant" || (includeTools && role === "toolResult")) {
      const text = messageText(entry.message);
      if (!query || text.toLowerCase().includes(query.toLowerCase())) result.push({ entry: entry.id, role, text: text.slice(0, 5000) });
      if (result.length >= limit) break;
    }
    last = entry.parentId ?? undefined;
  }
  return result.reverse();
}

export function registerHistory(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "history", label: "History", exposure: "codemode", annotations: { readOnlyHint: true, openWorldHint: false }, description: "Bounded recall of the active Pi branch or recent sessions in this project's session directory only. For explicitly requested recent-work/pickup/correct/automate-me mining. Metadata is listed first; search includes only matching user/assistant text, not thinking, images, credentials, or other projects. includeTools only when the question hinges on actual tool activity.",
    parameters: Type.Object({ action: enumSchema(["current", "list", "search"]), query: Type.Optional(Type.String()), days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })), includeTools: Type.Optional(Type.Boolean()) }), outputSchema: dataSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (params.action === "current") {
        const entries = ctx.sessionManager.getBranch().filter((entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant" || (params.includeTools && entry.message.role === "toolResult"))).map((entry) => entry.type === "message" ? { entry: entry.id, role: entry.message.role, text: messageText(entry.message).slice(0, 5000) } : undefined).filter(Boolean);
        return dataResult({ session: ctx.sessionManager.getSessionId(), path: ctx.sessionManager.getSessionFile(), messages: entries.slice(-(params.limit ?? 20)) });
      }
      const days = params.days ?? 7;
      const cutoff = Date.now() - days * 86400000;
      const recent = (await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir(), undefined, signal)).filter((session) => canonicalPath(session.cwd) === canonicalPath(ctx.cwd) && session.modified.getTime() >= cutoff && session.id !== ctx.sessionManager.getSessionId()).sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, params.limit ?? 8);
      if (params.action === "list") return dataResult({ scope: { cwd: ctx.cwd, days }, sessions: recent.map(({ id, path, name, modified }) => ({ id, path, name, modified })) });
      const result = await Promise.allSettled(recent.map(async (session) => ({ id: session.id, path: session.path, messages: await transcriptSlice(session.path, params.query ?? "", params.includeTools ?? false, 12, signal) })));
      return dataResult({ scope: { cwd: ctx.cwd, days }, results: result.map((entry, i) => entry.status === "fulfilled" ? entry.value : { id: recent[i]?.id, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) }) });
    },
  });
}
