import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { type IO, main } from "../src/cli";
import { defaultConfig, paths, writeConfig } from "../src/vault";
import { makeVault, tmpHome } from "./helpers";

let home: string, vault: string;
const io: IO = { out: () => {}, err: () => {}, ask: async () => "", stdin: async () => "" };
const withStdin = (s: string): IO => ({ ...io, stdin: async () => s });
beforeEach(() => { home = tmpHome(); vault = makeVault(home); delete process.env.AGENT_TASTE_CAPTURE; });

test("recursion guard exits 0 without touching anything", async () => {
  process.env.AGENT_TASTE_CAPTURE = "1";
  expect(await main(["capture", "--stdin"], withStdin('{"transcript_path":"/x"}'))).toBe(0);
  expect(fs.existsSync(paths(vault).json)).toBe(false);
});

test("missing vault (drive not mounted) exits 0", async () => {
  fs.rmSync(vault, { recursive: true });
  expect(await main(["capture", "--stdin"], withStdin('{"transcript_path":"/x"}'))).toBe(0);
});

test("garbage stdin exits 0", async () => {
  expect(await main(["capture", "--stdin"], withStdin("not json"))).toBe(0);
});

test("hook off: regenerates json, spawns nothing", async () => {
  writeConfig(vault, { ...defaultConfig(vault), hook: { enabled: false, model: "sonnet", minChars: 400 } });
  const t0 = Date.now();
  expect(await main(["capture", "--stdin"], withStdin(JSON.stringify({ transcript_path: path.join(home, "t.jsonl") })))).toBe(0);
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(fs.existsSync(paths(vault).json)).toBe(true);
  expect(fs.existsSync(paths(vault).log)).toBe(false);
});

test("hook on with missing transcript: returns fast, logs nothing fatal", async () => {
  const t0 = Date.now();
  expect(await main(["capture", "--stdin"], withStdin(JSON.stringify({ transcript_path: "/does/not/exist.jsonl" })))).toBe(0);
  expect(Date.now() - t0).toBeLessThan(1000);
});
