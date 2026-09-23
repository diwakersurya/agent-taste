import fs from "node:fs";
import path from "node:path";
import { which } from "../capture";
import { type Ctx, editJson, hasBlock, instruction, type Integration, removeBlock, upsertBlock } from "./blocks";

const mdFile = (ctx: Ctx) => path.join(ctx.home, ".claude", "CLAUDE.md");
export const settingsFile = (ctx: Ctx) => path.join(ctx.home, ".claude", "settings.json");
const MARK = "agent-taste.js";

export function setHook(ctx: Ctx, on: boolean) {
  editJson(settingsFile(ctx), (o) => {
    const list = ((o.hooks?.SessionEnd ?? []) as unknown[]).filter((e) => !JSON.stringify(e).includes(MARK));
    if (on) list.push({ hooks: [{ type: "command", command: `f="${ctx.bin}"; [ -f "$f" ] && node "$f" capture --stdin; exit 0`, timeout: 10 }] });
    if (list.length) { o.hooks ??= {}; o.hooks.SessionEnd = list; }
    else if (o.hooks) {
      delete o.hooks.SessionEnd;
      if (!Object.keys(o.hooks).length) delete o.hooks;
    }
  });
}

export const integration: Integration = {
  id: "claude", label: "Claude Code",
  detect: (ctx) => fs.existsSync(path.join(ctx.home, ".claude")) || !!which("claude"),
  installed: (ctx) => hasBlock(mdFile(ctx)),
  install(ctx, cfg) {
    upsertBlock(mdFile(ctx), `@~/.agent-taste/taste.md\n\n${instruction(ctx)}`);
    setHook(ctx, cfg.hook.enabled);
  },
  remove(ctx) {
    removeBlock(mdFile(ctx));
    setHook(ctx, false);
  },
};
