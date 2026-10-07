import { createRequire } from "node:module";

export function ensureDependenciesInstalled(): void {
  try { createRequire(import.meta.url).resolve("commander"); }
  catch { throw new Error("codemax's script dependencies are missing. Install the package dependencies with npm install before running these scripts. No software is installed automatically."); }
}
