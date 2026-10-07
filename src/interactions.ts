import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { dataResult, dataSchema } from "./output.ts";

export function registerAsk(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask", label: "Ask", exposure: "codemode", executionMode: "sequential", description: "Ask one genuine product/preference question or request approval. Prefer observing facts with tools. Without UI, returns needs_user_input and never assumes approval. Do not pass secrets through answers; /login owns credentials.",
    parameters: Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String(), { minItems: 2, maxItems: 12 })), confirm: Type.Optional(Type.Boolean()) }), outputSchema: dataSchema,
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) return dataResult({ status: "needs_user_input", question: params.question, options: params.options, approved: false });
      if (params.confirm) return dataResult({ status: "answered", approved: await ctx.ui.confirm("codemax approval", params.question) });
      const answer = params.options ? await ctx.ui.select(params.question, params.options) : await ctx.ui.input(params.question);
      return dataResult({ status: answer === undefined ? "canceled" : "answered", answer });
    },
  });
}
