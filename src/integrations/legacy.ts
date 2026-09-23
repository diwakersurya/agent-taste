import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "../vault";
import { backupOnce, type Ctx, editJson } from "./blocks";
import { settingsFile } from "./claude";
import { desktopConfigFile } from "./claudeDesktop";

// Hand-made setup that predates the package (author's machine). No-op elsewhere.
const LEGACY_MD = /(\n?@[^\n]*taste\.md\n\n)?\n?<!-- taste-log:start -->[\s\S]*?<!-- taste-log:end -->\n(At session start, read [^\n]*taste\.md[^\n]*\n)?/;

export function cleanLegacy(ctx: Ctx): string[] {
  const changed: string[] = [];
  for (const rel of [".claude/CLAUDE.md", ".gemini/GEMINI.md", ".codex/AGENTS.md"]) {
    const f = path.join(ctx.home, rel);
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, "utf8");
    const next = cur.replace(LEGACY_MD, "");
    if (next !== cur) { backupOnce(f); atomicWrite(f, next); changed.push(f); }
  }
  const s = settingsFile(ctx);
  if (fs.existsSync(s)) {
    const before = fs.readFileSync(s, "utf8");
    editJson(s, (o) => {
      const list = o.hooks?.SessionEnd;
      if (!Array.isArray(list)) return;
      const kept = list.filter((e: unknown) => !JSON.stringify(e).includes("taste_hook.sh"));
      if (kept.length !== list.length) o.hooks.SessionEnd = kept;
    });
    if (fs.readFileSync(s, "utf8") !== before) changed.push(s);
  }
  const d = desktopConfigFile(ctx);
  if (fs.existsSync(d)) {
    const before = fs.readFileSync(d, "utf8");
    editJson(d, (o) => {
      const e = o.mcpServers?.["ai-vault"];
      if (e && JSON.stringify(e).includes("server-filesystem")) delete o.mcpServers["ai-vault"];
    });
    if (fs.readFileSync(d, "utf8") !== before) changed.push(d);
  }
  return changed;
}
