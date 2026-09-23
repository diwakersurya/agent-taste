import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { addPref } from "../src/doc";
import {
  appendLog, defaultConfig, loadDoc, month, paths, readConfig, resolveVault, saveDoc, today, VaultError, withLock, writeConfig,
} from "../src/vault";
import { makeVault, MIN, tmpHome } from "./helpers";

let home: string;
beforeEach(() => { home = tmpHome(); });

test("resolveVault follows symlink", () => {
  const v = makeVault(home);
  expect(resolveVault()).toBe(v);
});

test("resolveVault errors clearly when missing or dangling", () => {
  expect(() => resolveVault()).toThrow(VaultError);
  const v = makeVault(home);
  fs.rmSync(v, { recursive: true });
  expect(() => resolveVault()).toThrow(/not found/);
});

test("config defaults merge with partial file", () => {
  const v = makeVault(home);
  fs.writeFileSync(paths(v).config, JSON.stringify({ hook: { model: "haiku" } }));
  const c = readConfig(v);
  expect(c.hook).toEqual({ enabled: true, model: "haiku", minChars: 400 });
  expect(c.remote.excludeSections).toEqual(["financial", "personal"]);
  writeConfig(v, { ...c, engine: "codex" });
  expect(readConfig(v).engine).toBe("codex");
  expect(defaultConfig(v).vault).toBe(v);
});

test("saveDoc writes md and json atomically", () => {
  const v = makeVault(home);
  const d = loadDoc(v);
  addPref(d, "Personal", "Tea", "2026-10");
  saveDoc(v, d);
  expect(fs.readFileSync(paths(v).md, "utf8")).toContain("- Tea (seen 1x, 2026-10)");
  expect(JSON.parse(fs.readFileSync(paths(v).json, "utf8")).sections.personal.preferences[0].text).toBe("Tea");
  expect(fs.readdirSync(v).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});

test("withLock serializes concurrent writers", async () => {
  const v = makeVault(home);
  const order: string[] = [];
  const slow = withLock(v, async () => { order.push("a1"); await Bun.sleep(700); order.push("a2"); });
  await Bun.sleep(50);
  const fast = withLock(v, () => { order.push("b"); });
  await Promise.all([slow, fast]);
  expect(order).toEqual(["a1", "a2", "b"]);
  expect(fs.existsSync(paths(v).lock)).toBe(false);
});

test("withLock steals stale lock", async () => {
  const v = makeVault(home);
  fs.writeFileSync(paths(v).lock, "");
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(paths(v).lock, old, old);
  expect(await withLock(v, () => 42)).toBe(42);
});

test("log and dates", () => {
  const v = makeVault(home, MIN);
  appendLog(v, "hello");
  expect(fs.readFileSync(path.join(v, "capture.log"), "utf8")).toMatch(/^\d{4}-\d{2}-\d{2}T.* hello\n$/);
  expect(month(new Date("2026-09-23T10:00:00Z"))).toBe("2026-09");
  expect(today(new Date("2026-09-23T10:00:00Z"))).toBe("2026-09-23");
});
