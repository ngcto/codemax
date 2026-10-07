import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.ts";

export interface WorkflowStep { id: string; text: string; status: "pending" | "running" | "done" | "skipped" | "blocked"; evidence: string[]; reason?: string; }
export interface WorkflowRun { id: string; name: string; task: string; status: "active" | "paused" | "complete"; steps: WorkflowStep[]; decisions: { at: string; decision: string; evidence: string[] }[]; }
export interface Evidence { id: string; label: string; command: string; cwd: string; expectedExit: number; exitCode: number | null; passed: boolean; output: string; artifact: string; timestamp: string; }
export interface StoredCapability { name: string; description: string; code: string; parameters: Record<string, unknown>; outputSchema?: Record<string, unknown>; tools?: string[]; }
export interface SessionState { version: 1; workflows: WorkflowRun[]; evidence: Evidence[]; capabilities: StoredCapability[]; configuration?: Config; learned: { name: string; description: string; path: string }[]; }
export function initialState(): SessionState { return { version: 1, workflows: [], evidence: [], capabilities: [], learned: [] }; }

export class BranchState {
  value: SessionState = initialState();
  constructor(private readonly pi: ExtensionAPI) {}
  restore(ctx: ExtensionContext): void {
    this.value = initialState();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "codemax-state") {
        const candidate = entry.data as SessionState | undefined;
        if (candidate?.version === 1 && Array.isArray(candidate.workflows) && Array.isArray(candidate.evidence) && Array.isArray(candidate.capabilities) && Array.isArray(candidate.learned)) {
          this.value = structuredClone(candidate);
        }
      }
    }
  }
  commit(update: (state: SessionState) => void): void {
    const next = structuredClone(this.value);
    update(next);
    this.pi.appendEntry("codemax-state", next);
    this.value = next;
  }
}
