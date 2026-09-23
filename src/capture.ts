import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decisions, type Doc, DECISIONS, entries, hintOf } from "./doc";
import { CAPTURE_MARK, extractFile, renderSessions } from "./extract";
import { applyOps, type Caps, HOOK_CAPS, type Op, snapshotOf, validateOps } from "./ops";
import { appendLog, type Config, loadDoc, paths, readConfig, saveDoc, withLock } from "./vault";

export function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const f = path.join(dir, bin);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {}
  }
  return null;
}

// Verified 2026-09-23: claude -p / --model / --no-session-persistence / --output-format (claude --help).
// codex `exec -` and gemini `-p ""` + stdin are from their docs; not verifiable here (codex absent, gemini broken locally).
export function engineArgv(cfg: Config, find: (b: string) => string | null = which): string[] | null {
  if (path.isAbsolute(cfg.engine)) return [cfg.engine];
  for (const b of cfg.engine === "auto" ? ["claude", "codex", "gemini"] : [cfg.engine]) {
    const p = find(b);
    if (!p) continue;
    if (b === "claude") // no tools, no MCP servers, no project settings/hooks: the engine only returns JSON
      return [p, "-p", "--model", cfg.hook.model, "--no-session-persistence", "--output-format", "text",
        "--tools", "", "--strict-mcp-config", "--setting-sources", "user"];
    if (b === "codex") return [p, "exec", "-"];
    return [p, "-p", ""]; // gemini: stdin is appended to the (empty) -p prompt
  }
  return null;
}

export function buildPrompt(doc: Doc, messages: string): string {
  const secs = doc.sections.filter((s) => s.slug !== DECISIONS).map((s) => {
    const hint = hintOf(s);
    const lines = entries(doc).filter((e) => e.section === s).map((e) => `[${e.id}] ${e.pref.raw.replace(/\r$/, "").slice(2)}`);
    return `### ${s.slug} — ${s.title}${hint ? ` (hint: ${hint})` : ""}\n${lines.join("\n") || "(empty)"}`;
  });
  const recent = decisions(doc).slice(0, 10).map((d) => `- ${d.date ?? "undated"} ${d.choice}`).join("\n");
  return `${CAPTURE_MARK}
You maintain a user's long-term taste profile. Below are the profile and the user's own messages from recent AI sessions.
Find DURABLE taste: choices between options (especially overriding a recommendation), corrections, rejected approaches, stated likes/dislikes, recurring tools or workflow. Ignore one-off task details, project facts, bug specifics.

PROFILE SECTIONS (entry ids in brackets):
${secs.join("\n\n")}

RECENT DECISIONS:
${recent || "(none)"}

USER MESSAGES:
${messages}

Reply with ONLY one JSON object: {"ops":[...]}. Allowed ops:
{"op":"bump","id":"<id>"}                         the messages re-confirm an existing entry
{"op":"replace","id":"<id>","text":"<new text>"}  the messages refine or contradict an entry
{"op":"add","section":"<section slug>","text":"<preference>"}  new durable preference, one sentence, no evidence suffix
{"op":"log","date":"YYYY-MM-DD","folder":"<project folder basename or ~>","choice":"<what was chosen>","why":"<short reason>"}
Rules: prefer bump/replace over add; never duplicate; financial/personal sections hold preferences only, never numbers, accounts, credentials, IDs, health, addresses or other people's names; if nothing durable, reply {"ops":[]}.`;
}

export function runEngine(argv: string[], input: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(argv[0], argv.slice(1), { cwd: os.tmpdir(), env: { ...process.env, TASTE_PROFILE_CAPTURE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error(`engine timed out after ${timeoutMs}ms`)); }, timeoutMs);
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("error", (e) => { clearTimeout(t); reject(e); });
    c.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`engine exited ${code}: ${err.slice(0, 300)}`)); });
    c.stdin.on("error", () => {});
    c.stdin.end(input);
  });
}

export function parseOps(out: string): unknown[] {
  for (let i = out.indexOf("{"); i !== -1; i = out.indexOf("{", i + 1))
    for (let j = out.lastIndexOf("}"); j > i; j = out.lastIndexOf("}", j - 1)) {
      try {
        const v = JSON.parse(out.slice(i, j + 1));
        if (v && Array.isArray(v.ops)) return v.ops;
      } catch {}
    }
  throw new Error(`no {"ops": [...]} JSON in engine output: ${out.slice(0, 500)}`);
}

export async function captureText(
  vault: string, text: string,
  o: { caps: Caps; source: string; tool?: string; now?: Date; dryRun?: boolean },
): Promise<{ applied: number; dropped: string[]; ops: Op[] }> {
  const argv = engineArgv(readConfig(vault));
  if (!argv) {
    appendLog(vault, `${o.source} no engine found (install claude, codex or gemini CLI)`);
    return { applied: 0, dropped: [], ops: [] };
  }
  const before = loadDoc(vault);
  const snap = snapshotOf(before);
  let raw: unknown[];
  try {
    raw = parseOps(await runEngine(argv, buildPrompt(before, text)));
  } catch (e) {
    appendLog(vault, `${o.source} engine error: ${(e as Error).message.slice(0, 500)}`);
    throw e;
  }
  const { ok, dropped } = validateOps(raw, before, o.caps);
  if (o.dryRun) return { applied: 0, dropped: dropped.map((d) => d.reason), ops: ok };
  const res = await withLock(vault, () => {
    const doc = loadDoc(vault);
    const r = applyOps(doc, ok, snap, o.now ?? new Date(), o.tool ?? "claude");
    saveDoc(vault, doc);
    return r;
  });
  const all = [...dropped.map((d) => d.reason), ...res.dropped];
  appendLog(vault, `${o.source} engine=${path.basename(argv[0])} applied=${res.applied} dropped=${all.length}${all.length ? ` (${all.join("; ")})` : ""}`);
  return { applied: res.applied, dropped: all, ops: ok };
}

export async function captureTranscript(vault: string, file: string): Promise<void> {
  const cfg = readConfig(vault);
  const s = extractFile(file);
  const text = s ? renderSessions([s]) : "";
  if (text.length < cfg.hook.minChars) {
    appendLog(vault, `skip ${file} (${text.length} chars of user messages)`);
    return;
  }
  await captureText(vault, text, { caps: HOOK_CAPS, source: path.basename(file), tool: s!.tool });
}

export function detachCapture(vault: string, transcript: string, self = process.argv[1]) {
  const fd = fs.openSync(paths(vault).log, "a");
  spawn(process.execPath, [self, "capture", transcript, "--foreground"], { detached: true, stdio: ["ignore", fd, fd] }).unref();
}
