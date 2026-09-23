import fs from "node:fs";
import path from "node:path";
import { atomicWrite, type Config } from "../vault";

export const START = "<!-- agent-taste:start -->";
export const END = "<!-- agent-taste:end -->";
const BLOCK = /\n<!-- agent-taste:start -->[\s\S]*?<!-- agent-taste:end -->\n/;
const BAK = ".bak-agent-taste";

export class IntegrationError extends Error {}

export type Ctx = { home: string; bin: string; node: string; taste: string };
export type IntegrationId = "claude" | "gemini" | "codex" | "claudeDesktop" | "chatgpt";
export type Integration = {
  id: IntegrationId; label: string;
  detect(ctx: Ctx): boolean; installed(ctx: Ctx): boolean;
  install(ctx: Ctx, cfg: Config): void; remove(ctx: Ctx): void;
};

export const makeCtx = (home: string): Ctx => ({
  home,
  bin: path.join(home, ".agent-taste", "bin", "agent-taste.js"),
  node: process.execPath,
  taste: path.join(home, ".agent-taste", "taste.md"),
});

export const instruction = (ctx: Ctx) =>
  `My long-term preferences live in ${ctx.taste}. Follow them.
When I make a decision revealing durable taste (choose X over Y, reject an approach, correct your style), update that file: add a line to "Decision log" (\`- YYYY-MM-DD [tool] [folder] choice — why\`) and, for general preferences, a bullet in the matching section ending with \`(seen Nx, YYYY-MM)\`. Skip one-off details. Replace conflicting entries instead of duplicating. Never edit taste.json.`;

const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

export function backupOnce(f: string) {
  if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.copyFileSync(f, f + BAK);
}

export const hasBlock = (f: string) => BLOCK.test(read(f) ?? "");

export function upsertBlock(file: string, body: string) {
  const cur = read(file);
  backupOnce(file);
  const next = (cur ?? "").replace(BLOCK, "") + `\n${START}\n${body}\n${END}\n`;
  if (next !== cur) atomicWrite(file, next);
}

export function removeBlock(file: string) {
  const cur = read(file);
  if (cur === null) return;
  const next = cur.replace(BLOCK, "");
  if (next === cur) return;
  if (next === "" && !fs.existsSync(file + BAK)) fs.rmSync(file);
  else atomicWrite(file, next);
}

export function editJson(file: string, fn: (o: any) => void) {
  const cur = read(file);
  let obj: any = {};
  if (cur !== null && cur.trim()) {
    try { obj = JSON.parse(cur); } catch { throw new IntegrationError(`${file} is not valid JSON; not touching it`); }
  }
  const indent = cur?.match(/^([ \t]+)"/m)?.[1] ?? "  ";
  const before = JSON.stringify(obj);
  fn(obj);
  if (JSON.stringify(obj) === before) return;
  backupOnce(file);
  if (Object.keys(obj).length === 0 && !fs.existsSync(file + BAK)) { if (cur !== null) fs.rmSync(file); return; }
  atomicWrite(file, JSON.stringify(obj, null, indent) + (cur === null || cur.endsWith("\n") ? "\n" : ""));
}
