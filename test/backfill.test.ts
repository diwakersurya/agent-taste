import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { chunk, listTranscripts } from "../src/backfill";
import { type IO, main } from "../src/cli";
import { defaultConfig, paths, writeConfig } from "../src/vault";
import { makeVault, tmpHome } from "./helpers";

let home: string, vault: string, outs: string[];
const io: IO = { out: (s) => outs.push(s), err: () => {}, ask: async () => "", stdin: async () => "" };
const FAKE = new URL("./fixtures/fake-engine.sh", import.meta.url).pathname;
const fixture = (n: string) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

beforeEach(() => {
  home = tmpHome(); vault = makeVault(home); outs = [];
  writeConfig(vault, { ...defaultConfig(vault), engine: FAKE });
  process.env.FAKE_OUT = path.join(home, "out.json");
  delete process.env.FAKE_SLEEP;
  fs.mkdirSync(path.join(home, ".claude/projects/-p"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude/projects/-p/a.jsonl"), fixture("claude.jsonl"));
  fs.mkdirSync(path.join(home, ".codex/sessions/2026/03"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex/sessions/2026/03/b.jsonl"), fixture("codex-new.jsonl"));
  fs.mkdirSync(path.join(home, ".gemini/tmp/h/chats"), { recursive: true });
  fs.writeFileSync(path.join(home, ".gemini/tmp/h/chats/c.json"), fixture("gemini.json"));
  const old = new Date(Date.now() - 90 * 86400_000);
  fs.utimesSync(path.join(home, ".gemini/tmp/h/chats/c.json"), old, old);
});

test("listTranscripts by tool and age", () => {
  expect(listTranscripts(home, 30).map((f) => path.basename(f)).sort()).toEqual(["a.jsonl", "b.jsonl"]);
  expect(listTranscripts(home, 365, "gemini").map((f) => path.basename(f))).toEqual(["c.json"]);
});

test("chunk splits on session boundaries", () => {
  const s = "\n## a\n> " + "x".repeat(60) + "\n\n## b\n> " + "y".repeat(60) + "\n";
  expect(chunk(s, 80)).toHaveLength(2);
  expect(chunk(s, 10_000)).toHaveLength(1);
});

test("backfill --dry-run prints ops, applies nothing", async () => {
  fs.writeFileSync(process.env.FAKE_OUT!, JSON.stringify({ ops: [{ op: "add", section: "Personal", text: "Tea" }] }));
  const before = fs.readFileSync(paths(vault).md, "utf8");
  expect(await main(["backfill", "--dry-run"], io)).toBe(0);
  expect(outs.join("\n")).toContain('"text":"Tea"');
  expect(fs.readFileSync(paths(vault).md, "utf8")).toBe(before);
});

test("backfill applies", async () => {
  fs.writeFileSync(process.env.FAKE_OUT!, JSON.stringify({ ops: [{ op: "add", section: "Personal", text: "Tea" }] }));
  expect(await main(["backfill", "--since", "30d"], io)).toBe(0);
  expect(fs.readFileSync(paths(vault).md, "utf8")).toContain("- Tea (seen 1x");
});
