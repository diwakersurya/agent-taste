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
