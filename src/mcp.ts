import crypto from "node:crypto";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ARCHIVED, decisions, type Doc, entries, findSection, hintOf, norm, serialize, slug } from "./doc";
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
  // Archived can hold entries moved out of hidden sections, so it is never exposed remotely.
  const hidden = (s: string) => o.remote && (s === ARCHIVED || readConfig(vault).remote.excludeSections.includes(s));
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

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function authorize(req: http.IncomingMessage, tokenHash: string | null): boolean {
  if (!tokenHash) return false;
  const p = new URL(req.url ?? "/", "http://x").pathname;
  const h = req.headers.authorization;
  const tok = h?.startsWith("Bearer ") ? h.slice(7) : /^\/mcp\/([A-Za-z0-9_-]+)$/.exec(p)?.[1];
  if (!tok) return false;
  const a = Buffer.from(hashToken(tok), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com)$/];

export function startHttp(vault: string, o: { port?: number; readOnly?: boolean } = {}): Promise<http.Server> {
  const cfg0 = readConfig(vault);
  if (!cfg0.remote.tokenHash) throw new Error("No token set. Run: agent-taste integrate chatgpt");
  const allowWrite = makeLimiter(cfg0.remote.writesPerHour);
  const srv = http.createServer(async (req, res) => {
    const deny = (code: number, msg: string) => { if (!res.headersSent) res.writeHead(code, { "content-type": "text/plain" }); res.end(msg); };
    try {
      const origin = req.headers.origin;
      if (origin && !ORIGINS.some((r) => r.test(origin))) return deny(403, "forbidden");
      const p = new URL(req.url ?? "/", "http://x").pathname;
      if (p !== "/mcp" && !p.startsWith("/mcp/")) return deny(404, "not found");
      if (!authorize(req, readConfig(vault).remote.tokenHash)) return deny(401, "unauthorized");
      if (Number(req.headers["content-length"] ?? 0) > 65_536) return deny(413, "too large");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req as AsyncIterable<Buffer>) {
        size += c.length;
        if (size > 65_536) return deny(413, "too large");
        chunks.push(c);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown;
      if (body) { try { parsed = JSON.parse(body); } catch { return deny(400, "bad json"); } }
      const server = createServer(vault, { remote: true, source: "chatgpt", readOnly: o.readOnly, allowWrite });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (e) {
      appendLog(vault, `mcp http error: ${(e as Error).message}`);
      deny(500, "error");
    }
  });
  return new Promise((resolve) => srv.listen(o.port ?? 7717, "127.0.0.1", () => resolve(srv)));
}
