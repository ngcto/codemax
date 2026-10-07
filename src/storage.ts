import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { assertMutable } from "./paths.ts";

export async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read valid JSON from " + path, { cause: error });
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  assertMutable(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    assertMutable(path);
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function updateJson<T>(path: string, parse: (input: unknown) => T, update: (current: T) => T): Promise<T> {
  return withFileMutationQueue(path, async () => {
    const next = update(parse(await readJson(path)));
    await atomicWrite(path, JSON.stringify(next, null, 2) + "\n");
    return next;
  });
}
