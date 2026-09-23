import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, makeLimiter, type ServerOpts } from "../src/mcp";
import { defaultConfig, paths, writeConfig } from "../src/vault";
import { makeVault, MIN, tmpHome } from "./helpers";

let vault: string;
beforeEach(() => { const h = tmpHome(); vault = makeVault(h, MIN.replace("<!-- hint: life -->\n", "<!-- hint: life -->\n- Morning runs (seen 1x, 2026-09)\n")); });

async function connect(o: ServerOpts) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(vault, o).connect(a);
  const c = new Client({ name: "test", version: "1" });
  await c.connect(b);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await c.callTool({ name, arguments: args });
    return { text: r.content.map((x: any) => x.text).join("\n") as string, isError: !!r.isError };
  };
}
const local: ServerOpts = { remote: false, source: "claude-desktop" };
const remote: ServerOpts = { remote: true, source: "chatgpt", allowWrite: () => true };

test("list/read/search locally", async () => {
  const call = await connect(local);
  expect((await call("list_sections")).text).toMatch(/Personal \[personal\] — 1 entries — life/);
  expect((await call("read_taste", { section: "Code style" })).text).toContain("Use X");
  expect((await call("read_taste")).text).toContain("## Decision log");
  expect((await call("search_taste", { query: "runs" })).text).toContain("[personal.1] Morning runs");
});

test("record_preference and record_decision write through filter", async () => {
  const call = await connect(local);
  expect((await call("record_preference", { section: "Code style", text: "Use Y" })).isError).toBe(false);
  expect((await call("record_preference", { section: "Code style", text: "sk-ant-api03-abcdefghijklmnop1234" })).isError).toBe(true);
  expect((await call("record_decision", { choice: "Picked B", why: "simpler", folder: "app" })).isError).toBe(false);
  const md = fs.readFileSync(paths(vault).md, "utf8");
  expect(md).toContain("- Use Y (seen 1x");
  expect(md).toMatch(/- \d{4}-\d{2}-\d{2} \[claude-desktop\] \[app\] Picked B — simpler/);
  expect(md).not.toContain("sk-ant");
});

test("remote hides excluded sections for reads and writes", async () => {
  const call = await connect(remote);
  expect((await call("list_sections")).text).not.toContain("Personal");
  expect((await call("read_taste")).text).not.toContain("Morning runs");
  expect((await call("read_taste", { section: "Personal" })).isError).toBe(true);
  expect((await call("search_taste", { query: "runs" })).text).not.toContain("Morning");
  expect((await call("record_preference", { section: "Personal", text: "x" })).isError).toBe(true);
});

test("remote read-only and rate limit", async () => {
  const ro = await connect({ ...remote, readOnly: true });
  expect((await ro("record_decision", { choice: "x" })).isError).toBe(true);
  const lim = makeLimiter(1);
  const limited = await connect({ ...remote, allowWrite: lim });
  expect((await limited("record_decision", { choice: "a" })).isError).toBe(false);
  expect((await limited("record_decision", { choice: "b" })).isError).toBe(true);
});

test("makeLimiter", () => {
  const l = makeLimiter(2);
  expect([l(), l(), l()]).toEqual([true, true, false]);
});
