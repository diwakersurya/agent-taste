import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { decisions, type Doc, entries, findSection, hintOf, norm, serialize, slug } from "./doc";
import { applyOps, type Op, snapshotOf, validateOps } from "./ops";
import { VERSION } from "./version";
import { appendLog, loadDoc, readConfig, saveDoc, withLock } from "./vault";

export type ServerOpts = { remote: boolean; source: string; readOnly?: boolean; allowWrite?: () => boolean };

export function makeLimiter(perHour: number): () => boolean {
  const hits: number[] = [];
  return () => {
    const now = Date.now();
    while (hits.length && hits[0] < now - 3_600_000) hits.shift();
    if (hits.length >= perHour) return false;
    hits.push(now);
    return true;
  };
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function createServer(vault: string, o: ServerOpts): McpServer {
  const hidden = (s: string) => o.remote && readConfig(vault).remote.excludeSections.includes(s);
  const visible = (doc: Doc): Doc => ({ preamble: doc.preamble, sections: doc.sections.filter((s) => !hidden(s.slug)) });
  const s = new McpServer({ name: "agent-taste", version: VERSION });

  s.registerTool("list_sections", { description: "List the user's taste profile sections with hints and entry counts.", inputSchema: {} }, async () => {
    const doc = visible(loadDoc(vault));
    return ok(doc.sections.map((x) => {
      const n = x.items.filter((i) => i.kind !== "other").length;
      const h = hintOf(x);
      return `${x.title} [${x.slug}] — ${n} entries${h ? ` — ${h}` : ""}`;
    }).join("\n"));
  });

  s.registerTool("read_taste", {
    description: "Read the user's taste profile (their durable preferences and past decisions). Call this before making style, tooling or design choices.",
    inputSchema: { section: z.string().optional() },
  }, async ({ section }) => {
    const doc = visible(loadDoc(vault));
    if (!section) return ok(serialize(doc));
    const sec = findSection(doc, section);
    if (!sec) return fail(`No readable section "${section}"`);
    return ok([sec.heading, ...sec.items.map((i) => i.raw)].join("\n"));
  });

  s.registerTool("search_taste", { description: "Search the taste profile for a term.", inputSchema: { query: z.string() } }, async ({ query }) => {
    const doc = visible(loadDoc(vault));
    const q = norm(query);
    const hits = [
      ...entries(doc).filter((e) => norm(e.pref.text).includes(q)).map((e) => `[${e.id}] ${e.pref.text}`),
      ...decisions(doc).filter((d) => norm(`${d.choice} ${d.why ?? ""}`).includes(q)).map((d) => `[log] ${d.date ?? "undated"} ${d.choice}${d.why ? ` — ${d.why}` : ""}`),
    ];
    return ok(hits.join("\n") || "(no matches)");
  });

  async function write(op: Op, label: string) {
    const cfg = readConfig(vault);
    if (o.remote && (o.readOnly || cfg.remote.readOnly)) return fail("This connection is read-only");
    const doc0 = loadDoc(vault);
    const { ok: good, dropped } = validateOps([op], doc0, { add: 1, log: 1, total: 1 }, { hidden });
    if (!good.length) return fail(`Not saved: ${dropped[0]?.reason ?? "invalid"}`);
    if (o.allowWrite && !o.allowWrite()) return fail("Rate limit reached; try again later");
    const snap = snapshotOf(doc0);
    const r = await withLock(vault, () => {
      const doc = loadDoc(vault);
      const res = applyOps(doc, good, snap, new Date(), o.source);
      saveDoc(vault, doc);
      return res;
    });
    appendLog(vault, `mcp source=${o.source} ${label} applied=${r.applied}`);
    return r.applied ? ok("Saved") : fail(`Not saved: ${r.dropped.join("; ")}`);
  }

  s.registerTool("record_preference", {
    description: "Save a durable preference the user just revealed (choice between options, correction, stated like/dislike). Adds a new entry or reinforces a matching one. One sentence.",
    inputSchema: { section: z.string(), text: z.string() },
  }, async ({ section, text }) => write({ op: "add", section, text }, `add ${slug(section)}`));

  s.registerTool("record_decision", {
    description: "Log a decision the user made, with a short reason.",
    inputSchema: { choice: z.string(), why: z.string().optional(), folder: z.string().optional() },
  }, async ({ choice, why, folder }) => write({ op: "log", choice, why, folder, tool: o.source }, "log"));

  return s;
}

export async function runStdio(vault: string) {
  await createServer(vault, { remote: false, source: "claude-desktop" }).connect(new StdioServerTransport());
}
