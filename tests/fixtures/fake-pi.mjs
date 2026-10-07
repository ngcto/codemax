#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const promptPath = args.find((arg) => arg.startsWith("@"))?.slice(1);
const task = promptPath ? readFileSync(promptPath, "utf8") : "";
if (task.includes("WAIT")) {
  setInterval(() => {}, 1000);
} else {
  const index = args.indexOf("--append-system-prompt");
  const policy = index < 0 ? "" : readFileSync(args[index + 1], "utf8");
  const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const text = JSON.stringify({ args, cwd: process.cwd(), task, hasPolicy: Boolean(policy), commentProfile: policy.includes("Comment Sicko"), ultracodeProfile: policy.includes("ultracode mode"), readonly: process.env.CODEMAX_READONLY, nested: process.env.CODEMAX_ALLOW_DELEGATION, depth: process.env.CODEMAX_DELEGATE_DEPTH, hasSlackSecret: Boolean(process.env.BENNY_SLACK_BOT_TOKEN), status: "ok" });
  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: task.trim() === "FAIL" ? "error" : "stop", usage } }));
  console.log(JSON.stringify({ type: "agent_settled" }));
}
