import { DECISIONS, type Doc, decisions, entries, hintOf } from "./doc";

type JPref = { id: string; text: string; seen: number | null; seen_plus: boolean; first: string | null; last: string | null };
export type TasteJson = {
  schema: 1; source: "taste.md"; generated_at: string;
  sections: Record<string, { title: string; hint: string | null; preferences: JPref[] }>;
  decisions: { date: string | null; tool: string | null; folder: string | null; choice: string; why: string | null }[];
};

export function toJson(doc: Doc, now = new Date()): TasteJson {
  const sections: TasteJson["sections"] = {};
  for (const s of doc.sections) if (s.slug !== DECISIONS) sections[s.slug] = { title: s.title, hint: hintOf(s), preferences: [] };
  for (const e of entries(doc))
    sections[e.section.slug].preferences.push({
      id: e.id, text: e.pref.text, seen: e.pref.seen, seen_plus: e.pref.plus, first: e.pref.first, last: e.pref.last });
  return {
    schema: 1, source: "taste.md",
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    sections,
    decisions: decisions(doc).map(({ date, tool, folder, choice, why }) => ({ date, tool, folder, choice, why })),
  };
}
