import fs from "node:fs";
import path from "node:path";
import { which } from "../capture";
import { type Ctx, hasBlock, instruction, type Integration, removeBlock, upsertBlock } from "./blocks";

const file = (ctx: Ctx) => path.join(ctx.home, ".codex", "AGENTS.md");

export const integration: Integration = {
  id: "codex", label: "Codex CLI",
  detect: (ctx) => fs.existsSync(path.join(ctx.home, ".codex")) || !!which("codex"),
  installed: (ctx) => hasBlock(file(ctx)),
  install: (ctx) => upsertBlock(file(ctx), `${instruction(ctx)}\nAt session start, read ${ctx.taste} before doing anything else.`),
  remove: (ctx) => removeBlock(file(ctx)),
};
