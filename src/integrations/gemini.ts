import fs from "node:fs";
import path from "node:path";
import { which } from "../capture";
import { type Ctx, hasBlock, instruction, type Integration, removeBlock, upsertBlock } from "./blocks";

const file = (ctx: Ctx) => path.join(ctx.home, ".gemini", "GEMINI.md");

export const integration: Integration = {
  id: "gemini", label: "Gemini CLI",
  detect: (ctx) => fs.existsSync(path.join(ctx.home, ".gemini")) || !!which("gemini"),
  installed: (ctx) => hasBlock(file(ctx)),
  install: (ctx) => upsertBlock(file(ctx), `@${ctx.taste}\n\n${instruction(ctx)}`),
  remove: (ctx) => removeBlock(file(ctx)),
};
