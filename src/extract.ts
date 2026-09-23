import fs from "node:fs";

export type Session = { tool: "claude" | "codex" | "gemini"; date: string; cwd: string; messages: string[] };
export const CAPTURE_MARK = "<taste-profile-capture/>";

const MAX = 1500;
const NOISE = /<(system-reminder|environment_context|command-[a-z]+|local-command-[a-z]+|user_instructions)>[\s\S]*?<\/\1>/g;
const SKIP = ["This session is being continued", "Caveat:", "[Request interrupted", "<", "# AGENTS.md"];
const DECISION_HINTS = ["questions have been answered", "user said:", "doesn't want to proceed"];

function clean(t: string): string {
  t = t.replace(NOISE, "").split("--- Content from referenced context ---")[0];
  if (t.includes("## My request for Codex:")) t = t.split("## My request for Codex:")[1];
  t = t.trim();
  if (!t || SKIP.some((s) => t.startsWith(s))) return "";
  return t.slice(0, MAX);
}

function* texts(content: unknown): Generator<string> {
  if (typeof content === "string") { yield content; return; }
  if (!Array.isArray(content)) return;
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" || b.type === "input_text") yield String(b.text ?? "");
    else if (b.type === "tool_result") {
      const c = b.content;
      const s = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x?.text ?? "").join(" ") : "";
      if (DECISION_HINTS.some((h) => s.includes(h))) yield s;
    }
  }
}

const keep = (content: unknown) => [...texts(content)].map(clean).filter(Boolean);

function jsonl(file: string): Session | null {
  const s: Session = { tool: "claude", date: "", cwd: "", messages: [] };
  let parsedAny = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== "object") continue;
    parsedAny = true;
    if ("payload" in d || "record_type" in d || d.type === "session_meta" || (d.type === "message" && d.role)) s.tool = "codex";
    const p = d.payload && typeof d.payload === "object" ? d.payload : d;
    s.date ||= String(d.timestamp ?? p.timestamp ?? "").slice(0, 10);
    s.cwd ||= d.cwd ?? p.cwd ?? "";
    if (d.isMeta || d.isSidechain) continue;
    const msg = d.type === "user" ? d.message : p.role === "user" ? p : null;
    if (msg) s.messages.push(...keep(msg.content));
  }
  return parsedAny ? s : null;
}

function gemini(file: string): Session | null {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(d?.messages)) return null;
  return {
    tool: "gemini", date: String(d.startTime ?? "").slice(0, 10), cwd: String(d.projectHash ?? "").slice(0, 8),
    messages: d.messages.filter((m: any) => m?.type === "user").flatMap((m: any) => keep(m.content)),
  };
}

export function extractFile(file: string): Session | null {
  try { return file.endsWith(".json") ? gemini(file) : jsonl(file); } catch { return null; }
}

export const renderSessions = (list: Session[]) =>
  list.filter((s) => s.messages.length)
    .map((s) => `\n## ${s.tool} ${s.date} ${s.cwd}\n` + s.messages.map((m) => "> " + m.replace(/\n/g, "\n> ")).join("\n") + "\n")
    .join("");
