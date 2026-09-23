import fs from "node:fs";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  addDecision, addPref, addSection, decisions, type Doc, DocError, entries, findSection, hintOf, norm,
  removeSection, renameSection, serialize, setHint,
} from "./doc";
import { isSensitive } from "./filter";
import { IntegrationError, makeCtx } from "./integrations/blocks";
import { setHook } from "./integrations/claude";
import { VERSION } from "./version";
import { captureTranscript, detachCapture } from "./capture";
import { cmdBackfill } from "./backfill";
import { runStdio } from "./mcp";
import { cmdInit, cmdIntegrate, cmdStatus, cmdUninstall, cmdUpdate } from "./setup";
import {
  type Config, home, loadDoc, month, readConfig, regenJson, resolveVault, saveDoc, today, VaultError, withLock, writeConfig,
} from "./vault";

export type IO = { out(s: string): void; err(s: string): void; ask(q: string): Promise<string>; stdin(): Promise<string> };

export const defaultIO = (): IO => ({
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  async ask(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(q)).trim(); } finally { rl.close(); }
  },
  async stdin() {
    let s = "";
    for await (const c of process.stdin) s += c;
    return s;
  },
});

export const HELP = `agent-taste ${VERSION} — one taste profile for all your AI agents

Setup
  agent-taste init [--dir <path>] [--preset developer|designer|general|custom] [--yes] [--no-hook]
  agent-taste status | update | uninstall [--purge]
  agent-taste integrate <claude|gemini|codex|claude-desktop|chatgpt> [--off]
  agent-taste hook on|off
  agent-taste config get|set <key> [value]

Profile
  agent-taste section list
  agent-taste section add "<title>" [--hint "<text>"] [--after "<title>"]
  agent-taste section rename "<old>" "<new>"
  agent-taste section hint "<title>" "<text>"
  agent-taste section remove "<title>" [--archive | --force]
  agent-taste add "<preference>" -s "<section>"
  agent-taste log "<choice>" [--why ..] [--folder ..] [--tool ..] [--date YYYY-MM-DD]
  agent-taste show [section] | search <term> | export json

Capture
  agent-taste capture [--stdin | <transcript>] [--foreground]
  agent-taste backfill [--since 30d] [--tool claude|codex|gemini] [--dry-run]
  agent-taste mcp [--http] [--port 7717] [--read-only] [--rotate-token]`;

const OPTIONS = {
  dir: { type: "string" }, preset: { type: "string" }, yes: { type: "boolean" }, "no-hook": { type: "boolean" },
  hint: { type: "string" }, after: { type: "string" }, archive: { type: "boolean" }, force: { type: "boolean" },
  section: { type: "string", short: "s" }, why: { type: "string" }, folder: { type: "string" }, tool: { type: "string" },
  date: { type: "string" }, off: { type: "boolean" }, stdin: { type: "boolean" }, foreground: { type: "boolean" },
  since: { type: "string" }, "dry-run": { type: "boolean" }, http: { type: "boolean" }, port: { type: "string" },
  "read-only": { type: "boolean" }, "rotate-token": { type: "boolean" }, purge: { type: "boolean" },
  help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
} as const;

export type Flags = ReturnType<typeof parse>["values"];
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });

class UsageError extends Error {}
const need = (v: string | undefined, what: string) => { if (!v) throw new UsageError(`Missing ${what}. See: agent-taste --help`); return v; };

async function mutate(fn: (doc: Doc) => void) {
  const vault = resolveVault();
  await withLock(vault, () => { const doc = loadDoc(vault); fn(doc); saveDoc(vault, doc); });
}

const SETTABLE: Record<string, "string" | "number" | "boolean"> = {
  "hook.enabled": "boolean", "hook.model": "string", "hook.minChars": "number", engine: "string",
  "remote.readOnly": "boolean", "remote.writesPerHour": "number",
};

function getPath(o: any, key: string) { return key.split(".").reduce((a, k) => a?.[k], o); }
function setPath(o: any, key: string, v: unknown) {
  const ks = key.split(".");
  ks.slice(0, -1).reduce((a, k) => a[k], o)[ks[ks.length - 1]] = v;
}

function sectionBody(doc: Doc, name?: string): string {
  if (!name) return serialize(doc);
  const s = findSection(doc, name);
  if (!s) throw new DocError(`No section "${name}"`);
  return [s.heading, ...s.items.map((i) => i.raw)].join("\n").replace(/\r/g, "").trimEnd();
}

async function content(cmd: string, pos: string[], f: Flags, io: IO): Promise<number> {
  switch (cmd) {
    case "section": {
      const [sub, a, b] = pos;
      if (sub === "list") {
        const doc = loadDoc(resolveVault());
        for (const s of doc.sections) {
          const n = s.items.filter((i) => i.kind !== "other").length;
          io.out(`${s.title.padEnd(32)} ${String(n).padStart(3)} entries  ${hintOf(s) ?? ""}`.trimEnd());
        }
        return 0;
      }
      await mutate((doc) => {
        if (sub === "add") addSection(doc, need(a, "section title"), { hint: f.hint, after: f.after });
        else if (sub === "rename") renameSection(doc, need(a, "old title"), need(b, "new title"));
        else if (sub === "hint") setHint(doc, need(a, "section title"), need(b, "hint text"));
        else if (sub === "remove") removeSection(doc, need(a, "section title"), f.archive ? "archive" : f.force ? "force" : "refuse");
        else throw new UsageError("section needs: list | add | rename | hint | remove");
      });
      io.out(`section ${sub}: done`);
      return 0;
    }
    case "add": {
      const text = need(pos[0], "preference text");
      if (isSensitive(text)) throw new DocError("That looks like a secret or personal identifier; not saved");
      let res = { id: "", bumped: false };
      await mutate((doc) => { res = addPref(doc, need(f.section, "--section / -s"), text, month()); });
      io.out(res.bumped ? `Reinforced existing ${res.id}` : `Added ${res.id}`);
      return 0;
    }
    case "log": {
      const choice = need(pos[0], "decision text");
      if ([choice, f.why ?? ""].some(isSensitive)) throw new DocError("That looks like a secret or personal identifier; not saved");
      if (f.date && !/^\d{4}-\d{2}(-\d{2})?$/.test(f.date)) throw new UsageError("--date must be YYYY-MM-DD");
      await mutate((doc) => addDecision(doc, { date: f.date ?? today(), tool: f.tool ?? "cli", folder: f.folder ?? "~", choice, why: f.why ?? null }));
      io.out("Logged");
      return 0;
    }
    case "show":
      io.out(sectionBody(loadDoc(resolveVault()), pos[0]));
      return 0;
    case "search": {
      const q = norm(need(pos[0], "search term"));
      const doc = loadDoc(resolveVault());
      for (const e of entries(doc)) if (norm(e.pref.text).includes(q)) io.out(`[${e.id}] ${e.pref.text}`);
      for (const d of decisions(doc))
        if (norm(`${d.choice} ${d.why ?? ""}`).includes(q)) io.out(`[log] ${d.date ?? "undated"} ${d.choice}${d.why ? ` — ${d.why}` : ""}`);
      return 0;
    }
    case "export":
      if (pos[0] !== "json") throw new UsageError("export supports: json");
      regenJson(resolveVault());
      io.out("taste.json regenerated");
      return 0;
    case "config": {
      const vault = resolveVault();
      const cfg = readConfig(vault);
      const [sub, key, val] = pos;
      if (sub === "get") { io.out(JSON.stringify(key ? getPath(cfg, key) : cfg, null, 2).replace(/^"|"$/g, "")); return 0; }
      if (sub !== "set") throw new UsageError("config needs: get | set");
      const t = SETTABLE[need(key, "key")];
      if (!t) throw new UsageError(`Not settable: ${key}. Settable: ${Object.keys(SETTABLE).join(", ")}`);
      const v = t === "number" ? Number(need(val, "value")) : t === "boolean" ? need(val, "value") === "true" : need(val, "value");
      if (t === "number" && Number.isNaN(v)) throw new UsageError(`${key} must be a number`);
      setPath(cfg, key, v);
      writeConfig(vault, cfg);
      io.out(`${key} = ${String(v)}`);
      return 0;
    }
    case "hook": {
      const on = pos[0] === "on";
      if (!["on", "off"].includes(pos[0] ?? "")) throw new UsageError("hook needs: on | off");
      const vault = resolveVault();
      const cfg: Config = readConfig(vault);
      cfg.hook.enabled = on;
      writeConfig(vault, cfg);
      if (cfg.integrations.claude) setHook(makeCtx(home()), on);
      io.out(`Auto-capture ${on ? "on" : "off"}`);
      return 0;
    }
  }
  return -1;
}

export async function cmdCapture(pos: string[], f: Flags, io: IO): Promise<number> {
  if (process.env.AGENT_TASTE_CAPTURE) return 0; // we are inside an engine run
  if (f.stdin) {
    // Hook path: must never fail or block Claude Code.
    try {
      const payload = JSON.parse(await io.stdin());
      const vault = resolveVault();
      regenJson(vault);
      if (!readConfig(vault).hook.enabled) return 0;
      const t = String(payload.transcript_path ?? "");
      if (t && fs.existsSync(t)) detachCapture(vault, t);
    } catch {}
    return 0;
  }
  await captureTranscript(resolveVault(), need(pos[0], "transcript path"));
  return 0;
}

export async function main(argv: string[], io: IO = defaultIO()): Promise<number> {
  try {
    const { values: f, positionals } = parse(argv);
    const [cmd, ...pos] = positionals;
    if (f.version) { io.out(VERSION); return 0; }
    if (f.help || !cmd) { io.out(HELP); return 0; }
    const r = await content(cmd, pos, f, io);
    if (r !== -1) return r;
    switch (cmd) {
      case "init": return await cmdInit(f, io);
      case "status": return cmdStatus(io);
      case "update": return cmdUpdate(io);
      case "integrate": return await cmdIntegrate(need(pos[0], "integration name"), f, io);
      case "uninstall": return await cmdUninstall(f, io);
      case "capture": return await cmdCapture(pos, f, io);
      case "backfill": return await cmdBackfill(f, io);
      case "mcp": {
        const vault = resolveVault();
        await runStdio(vault);
        return await new Promise<number>(() => {}); // stdio server runs until the client disconnects
      }
    }
    io.err(`Unknown command "${cmd}". See: agent-taste --help`);
    return 1;
  } catch (e) {
    if (e instanceof DocError || e instanceof VaultError || e instanceof UsageError || e instanceof IntegrationError || (e as { code?: string }).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      io.err((e as Error).message);
      return 1;
    }
    io.err(`agent-taste: ${(e as Error).stack ?? e}`);
    return 1;
  }
}

if (import.meta.main || process.argv[1]?.endsWith("agent-taste.js")) main(process.argv.slice(2)).then((c) => process.exit(c));
