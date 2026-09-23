export type Pref = { kind: "pref"; text: string; seen: number | null; plus: boolean; first: string | null; last: string | null; raw: string };
export type Decision = { kind: "decision"; date: string | null; tool: string | null; folder: string | null; choice: string; why: string | null; raw: string };
export type Other = { kind: "other"; raw: string };
export type Item = Pref | Decision | Other;
export type Section = { title: string; slug: string; heading: string; items: Item[] };
export type Doc = { preamble: string[]; sections: Section[] };

export const DECISIONS = "decision_log";
export const ARCHIVED = "archived";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const EVID = /\s*\(seen (\d+)x(\+?)(?:, ([\d-]+)(?:\.\.([\d-]+))?)?\)\s*$/;
const LOG = /^(\d{4}-\d{2}(?:-\d{2})?|undated) \[([^\]]*)\] \[([^\]]*)\] (.*)$/;
const HINT = /^<!--\s*(?:hint:\s*)?(.*?)\s*-->\r?$/;

const body = (raw: string) => raw.replace(/\r$/, "").slice(2).trim();

export function parsePref(raw: string): Pref {
  const b = body(raw);
  const m = EVID.exec(b);
  if (!m) return { kind: "pref", text: b, seen: null, plus: false, first: null, last: null, raw };
  const first = m[3] ?? null;
  let last = m[4] ?? null;
  if (first && last && last.length < first.length) last = first.slice(0, first.length - last.length) + last;
  return { kind: "pref", text: b.slice(0, m.index).trim(), seen: Number(m[1]), plus: m[2] === "+", first, last: last ?? first, raw };
}

export function parseDecision(raw: string): Decision {
  const b = body(raw);
  const m = LOG.exec(b);
  if (!m) return { kind: "decision", date: null, tool: null, folder: null, choice: b, why: null, raw };
  const [choice, ...why] = m[4].split(" — ");
  return {
    kind: "decision", date: m[1] === "undated" ? null : m[1], tool: m[2], folder: m[3],
    choice: choice.trim(), why: why.join(" — ").trim() || null, raw,
  };
}

export function parse(md: string): Doc {
  const doc: Doc = { preamble: [], sections: [] };
  let cur: Section | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      const title = line.slice(3).replace(/\r$/, "").trim();
      cur = { title, slug: slug(title), heading: line, items: [] };
      doc.sections.push(cur);
    } else if (!cur) doc.preamble.push(line);
    else if (line.startsWith("- ")) cur.items.push(cur.slug === DECISIONS ? parseDecision(line) : parsePref(line));
    else cur.items.push({ kind: "other", raw: line });
  }
  return doc;
}

export const serialize = (doc: Doc) =>
  [...doc.preamble, ...doc.sections.flatMap((s) => [s.heading, ...s.items.map((i) => i.raw)])].join("\n");

export function hintOf(s: Section): string | null {
  const first = s.items[0];
  if (first?.kind !== "other") return null;
  return HINT.exec(first.raw)?.[1] ?? null;
}

export class DocError extends Error {}

export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const cr = (doc: Doc): "" | "\r" => (serialize(doc).includes("\r\n") ? "\r" : "");
const isBlank = (raw: string) => raw.replace(/\r$/, "") === "";
const isComment = (raw: string) => raw.trim().startsWith("<!--");

export function formatPref(p: Pick<Pref, "text" | "seen" | "plus" | "first" | "last">): string {
  if (p.seen == null) return `- ${p.text}`;
  let range = "";
  if (p.first) {
    range = `, ${p.first}`;
    if (p.last && p.last !== p.first) {
      const short = p.last.length === p.first.length && p.last.slice(0, 5) === p.first.slice(0, 5);
      range += ".." + (short ? p.last.slice(5) : p.last);
    }
  }
  return `- ${p.text} (seen ${p.seen}x${p.plus ? "+" : ""}${range})`;
}

export function formatDecision(d: Pick<Decision, "date" | "tool" | "folder" | "choice" | "why">): string {
  return `- ${d.date ?? "undated"} [${d.tool ?? ""}] [${d.folder ?? ""}] ${d.choice}${d.why ? ` — ${d.why}` : ""}`;
}

export const findSection = (doc: Doc, name: string) => doc.sections.find((s) => s.slug === slug(name));

function must(doc: Doc, name: string): Section {
  const s = findSection(doc, name);
  if (!s) throw new DocError(`No section "${name}". Run: taste-profile section list`);
  return s;
}

function ensureBlankBefore(doc: Doc, idx: number, e: string) {
  if (idx === 0) {
    const last = doc.preamble[doc.preamble.length - 1];
    if (last !== undefined && !isBlank(last)) doc.preamble.push(e);
    return;
  }
  const items = doc.sections[idx - 1].items;
  const last = items[items.length - 1];
  if (!last || !isBlank(last.raw)) items.push({ kind: "other", raw: e });
}

function insertSection(doc: Doc, title: string, hintRaw: string | null, idx: number): Section {
  const e = cr(doc);
  const atEnd = idx === doc.sections.length;
  const sec: Section = { title, slug: slug(title), heading: `## ${title}${e}`, items: [] };
  if (hintRaw) sec.items.push({ kind: "other", raw: hintRaw + e });
  ensureBlankBefore(doc, idx, e);
  if (atEnd) {
    // the previous section's final "" (file's trailing newline) moves to the new last section
    const prev = idx > 0 ? doc.sections[idx - 1].items : null;
    const hadTrailing = prev && prev.length > 1 && isBlank(prev[prev.length - 1].raw) && isBlank(prev[prev.length - 2].raw);
    if (hadTrailing) prev!.pop();
    sec.items.push({ kind: "other", raw: "" });
  } else sec.items.push({ kind: "other", raw: e });
  doc.sections.splice(idx, 0, sec);
  return sec;
}

function checkNew(doc: Doc, title: string) {
  const s = slug(title);
  if (!s) throw new DocError("Section title is empty");
  if (s === DECISIONS || s === ARCHIVED) throw new DocError(`"${title}" is a reserved section name`);
  if (findSection(doc, title)) throw new DocError(`Section "${title}" already exists`);
}

export function addSection(doc: Doc, title: string, opts: { hint?: string; after?: string } = {}): Section {
  checkNew(doc, title);
  let idx: number;
  if (opts.after) idx = doc.sections.indexOf(must(doc, opts.after)) + 1;
  else {
    const r = doc.sections.findIndex((x) => x.slug === DECISIONS || x.slug === ARCHIVED);
    idx = r === -1 ? doc.sections.length : r;
  }
  return insertSection(doc, title, opts.hint ? `<!-- hint: ${opts.hint} -->` : null, idx);
}

export function renameSection(doc: Doc, from: string, to: string) {
  const s = must(doc, from);
  if (s.slug === DECISIONS || s.slug === ARCHIVED) throw new DocError(`"${s.title}" cannot be renamed`);
  if (slug(to) !== s.slug) checkNew(doc, to);
  s.title = to;
  s.slug = slug(to);
  s.heading = `## ${to}${cr(doc)}`;
}

export function setHint(doc: Doc, title: string, hint: string) {
  const s = must(doc, title);
  const raw = `<!-- hint: ${hint} -->${cr(doc)}`;
  if (s.items[0]?.kind === "other" && isComment(s.items[0].raw) && s.items[0].raw.trim().endsWith("-->")) s.items[0] = { kind: "other", raw };
  else s.items.unshift({ kind: "other", raw });
}

export function removeSection(doc: Doc, title: string, mode: "refuse" | "archive" | "force") {
  const s = must(doc, title);
  if (s.slug === DECISIONS) throw new DocError("The Decision log cannot be removed");
  const prefs = s.items.filter((i): i is Pref => i.kind === "pref");
  if (prefs.length && mode === "refuse")
    throw new DocError(`"${s.title}" has ${prefs.length} entr${prefs.length === 1 ? "y" : "ies"}; use --archive or --force`);
  const idx = doc.sections.indexOf(s);
  const trailing = idx === doc.sections.length - 1 && s.items.length > 0 && s.items[s.items.length - 1].raw === "";
  doc.sections.splice(idx, 1);
  if (trailing && doc.sections.length) {
    const last = doc.sections[doc.sections.length - 1].items;
    if (!last.length || last[last.length - 1].raw !== "") last.push({ kind: "other", raw: "" });
  }
  if (mode === "archive" && prefs.length) {
    const arch = findSection(doc, "Archived") ?? insertSection(doc, "Archived", "<!-- hint: entries from removed sections -->", doc.sections.length);
    for (const p of prefs) addRaw(doc, arch, formatPref({ ...p, text: `[${s.title}] ${p.text}` }));
  }
}

function addRaw(doc: Doc, s: Section, line: string): number {
  const p = parsePref(line + cr(doc));
  const lastPref = s.items.map((i) => i.kind).lastIndexOf("pref");
  let at = lastPref + 1;
  if (lastPref === -1) {
    at = 0;
    while (at < s.items.length && s.items[at].kind === "other" && isComment(s.items[at].raw)) at++;
  }
  s.items.splice(at, 0, p);
  return s.items.slice(0, at + 1).filter((i) => i.kind === "pref").length;
}

export type Entry = { id: string; section: Section; pref: Pref };

export const entries = (doc: Doc): Entry[] =>
  doc.sections
    .filter((s) => s.slug !== DECISIONS)
    .flatMap((s) => s.items.filter((i): i is Pref => i.kind === "pref").map((pref, n) => ({ id: `${s.slug}.${n + 1}`, section: s, pref })));

export const byId = (doc: Doc, id: string) => entries(doc).find((e) => e.id === id);

export function setPref(doc: Doc, p: Pref, fields: Partial<Pick<Pref, "text" | "seen" | "plus" | "first" | "last">>) {
  Object.assign(p, fields);
  p.raw = formatPref(p) + cr(doc);
}

export function bumpPref(doc: Doc, p: Pref, month: string) {
  setPref(doc, p, { seen: (p.seen ?? 0) + 1, first: p.first ?? month, last: p.last && p.last >= month ? p.last : month });
}

export function addPref(doc: Doc, section: string, text: string, month: string): { id: string; bumped: boolean } {
  const s = must(doc, section);
  if (s.slug === DECISIONS) throw new DocError("Use `taste-profile log` for decisions");
  const hit = entries(doc).find((e) => e.section === s && norm(e.pref.text) === norm(text));
  if (hit) {
    bumpPref(doc, hit.pref, month);
    return { id: hit.id, bumped: true };
  }
  const n = addRaw(doc, s, formatPref({ text, seen: 1, plus: false, first: month, last: month }));
  return { id: `${s.slug}.${n}`, bumped: false };
}

export function addDecision(doc: Doc, d: Pick<Decision, "date" | "tool" | "folder" | "choice" | "why">) {
  const s = findSection(doc, "Decision log") ?? insertSection(doc, "Decision log", "<!-- newest first: `- YYYY-MM-DD [tool] [folder] choice — why` -->", doc.sections.length);
  let at = s.items.findIndex((i) => i.kind === "decision");
  if (at === -1) {
    at = 0;
    while (at < s.items.length && isComment(s.items[at].raw)) at++;
  }
  s.items.splice(at, 0, parseDecision(formatDecision(d) + cr(doc)));
}

export const decisions = (doc: Doc): Decision[] =>
  doc.sections.filter((s) => s.slug === DECISIONS).flatMap((s) => s.items.filter((i): i is Decision => i.kind === "decision"));
