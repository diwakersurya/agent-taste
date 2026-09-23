import { addDecision, addPref, bumpPref, byId, DECISIONS, type Doc, entries, findSection, norm, setPref } from "./doc";
import { isSensitive } from "./filter";
import { month, today } from "./vault";

export type Op =
  | { op: "add"; section: string; text: string }
  | { op: "bump"; id: string }
  | { op: "replace"; id: string; text: string }
  | { op: "log"; date?: string; tool?: string; folder?: string; choice: string; why?: string };

export type Caps = { add: number; log: number; total: number };
export const HOOK_CAPS: Caps = { add: 5, log: 3, total: 10 };
export const BACKFILL_CAPS: Caps = { add: 40, log: 25, total: 80 };

const MAX = 300;
const DATE = /^\d{4}-\d{2}(-\d{2})?$/;
const TAG = /^[^\[\]\n\r]{0,60}$/;

function textProblem(t: unknown): string | null {
  if (typeof t !== "string" || !t.trim()) return "empty text";
  if (t.length > MAX) return `text over ${MAX} chars`;
  if (/[\r\n]/.test(t)) return "multi-line text";
  if (isSensitive(t)) return "looks like a secret or personal identifier";
  return null;
}

export function validateOps(raw: unknown, doc: Doc, caps: Caps, opts: { hidden?: (slug: string) => boolean } = {}) {
  const ok: Op[] = [];
  const dropped: { op: unknown; reason: string }[] = [];
  const count = { add: 0, log: 0 };
  const hidden = opts.hidden ?? (() => false);
  for (const o of Array.isArray(raw) ? raw : []) {
    const drop = (reason: string) => dropped.push({ op: o, reason });
    if (!o || typeof o !== "object" || typeof (o as { op?: unknown }).op !== "string") { drop("not an op object"); continue; }
    const op = o as Record<string, unknown>;
    if (ok.length >= caps.total) { drop("over total cap"); continue; }
    let problem: string | null = null;
    switch (op.op) {
      case "add": {
        const s = typeof op.section === "string" ? findSection(doc, op.section) : undefined;
        problem = !s ? `unknown section ${String(op.section)}` : s.slug === DECISIONS ? "use log for decisions"
          : hidden(s.slug) ? `section ${s.slug} not allowed here` : textProblem(op.text);
        if (!problem && count.add >= caps.add) problem = "over add cap";
        if (!problem) count.add++;
        break;
      }
      case "bump":
      case "replace": {
        const e = typeof op.id === "string" ? byId(doc, op.id) : undefined;
        problem = !e ? `unknown id ${String(op.id)}` : hidden(e.section.slug) ? `section ${e.section.slug} not allowed here`
          : op.op === "replace" ? textProblem(op.text) : null;
        break;
      }
      case "log": {
        problem = textProblem(op.choice);
        if (!problem && op.why !== undefined && op.why !== null && op.why !== "") problem = textProblem(op.why);
        if (!problem && op.date !== undefined && !(typeof op.date === "string" && DATE.test(op.date))) problem = "bad date";
        for (const k of ["tool", "folder"] as const)
          if (!problem && op[k] !== undefined && !(typeof op[k] === "string" && TAG.test(op[k] as string))) problem = `bad ${k}`;
        if (!problem && count.log >= caps.log) problem = "over log cap";
        if (!problem) count.log++;
        break;
      }
      default:
        problem = `unknown op ${String(op.op)}`;
    }
    if (problem) drop(problem);
    else ok.push(op as unknown as Op);
  }
  return { ok, dropped };
}

export type Snapshot = Map<string, { section: string; text: string }>;

export const snapshotOf = (doc: Doc): Snapshot =>
  new Map(entries(doc).map((e) => [e.id, { section: e.section.slug, text: e.pref.text }]));

export function applyOps(doc: Doc, ops: Op[], snap: Snapshot, now: Date, defaultTool = "cli") {
  let applied = 0;
  const dropped: string[] = [];
  const resolve = (id: string) => {
    const s = snap.get(id);
    return s && entries(doc).find((e) => e.section.slug === s.section && norm(e.pref.text) === norm(s.text));
  };
  for (const o of ops) {
    try {
      if (o.op === "add") addPref(doc, o.section, o.text, month(now));
      else if (o.op === "log")
        addDecision(doc, { date: o.date ?? today(now), tool: o.tool ?? defaultTool, folder: o.folder ?? "~", choice: o.choice, why: o.why || null });
      else {
        const e = resolve(o.id);
        if (!e) { dropped.push(`${o.id} changed since capture started`); continue; }
        if (o.op === "bump") bumpPref(doc, e.pref, month(now));
        else setPref(doc, e.pref, { text: o.text });
      }
      applied++;
    } catch (err) {
      dropped.push((err as Error).message);
    }
  }
  return { applied, dropped };
}
