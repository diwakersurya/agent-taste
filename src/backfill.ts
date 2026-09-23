import fs from "node:fs";
import path from "node:path";
import { captureText } from "./capture";
import type { Flags, IO } from "./cli";
import { extractFile, renderSessions } from "./extract";
import { BACKFILL_CAPS } from "./ops";
import { home, resolveVault } from "./vault";

function walk(dir: string, match: (f: string) => boolean, out: string[] = []): string[] {
  let names: fs.Dirent[] = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, match, out);
    else if (match(p)) out.push(p);
  }
  return out;
}

export function listTranscripts(h: string, sinceDays: number, tool?: string): string[] {
  const roots: [string, string, (f: string) => boolean][] = [
    ["claude", path.join(h, ".claude", "projects"), (f) => f.endsWith(".jsonl")],
    ["codex", path.join(h, ".codex", "sessions"), (f) => f.endsWith(".jsonl")],
    ["gemini", path.join(h, ".gemini", "tmp"), (f) => f.endsWith(".json") && f.includes(`${path.sep}chats${path.sep}`)],
  ];
  const cutoff = Date.now() - sinceDays * 86400_000;
  return roots
    .filter(([t]) => !tool || t === tool)
    .flatMap(([, root, m]) => walk(root, m))
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
    .filter((x) => x.t >= cutoff)
    .sort((a, b) => a.t - b.t)
    .map((x) => x.f);
}

export function chunk(text: string, max = 100_000): string[] {
  const parts = text.split(/(?=\n## )/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length > max) { out.push(cur); cur = ""; }
    cur += p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export async function cmdBackfill(f: Flags, io: IO): Promise<number> {
  const vault = resolveVault();
  const days = Number((f.since ?? "30d").replace(/d$/, ""));
  if (!Number.isFinite(days) || days <= 0) throw new Error("--since must look like 30d");
  const files = listTranscripts(home(), days, f.tool);
  const text = renderSessions(files.map(extractFile).filter((s) => s !== null));
  const chunks = chunk(text);
  io.out(`${files.length} transcripts, ${text.length} chars of your messages, ${chunks.length} engine call(s)`);
  for (const [i, c] of chunks.entries()) {
    const r = await captureText(vault, c, { caps: BACKFILL_CAPS, source: `backfill ${i + 1}/${chunks.length}`, tool: f.tool ?? "backfill", dryRun: f["dry-run"] });
    if (f["dry-run"]) for (const op of r.ops) io.out(JSON.stringify(op));
    else io.out(`chunk ${i + 1}: applied ${r.applied}, dropped ${r.dropped.length}`);
  }
  return 0;
}
