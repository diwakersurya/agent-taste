import { describe, expect, test } from "bun:test";
import { parse, serialize } from "../src/doc";
import { isSensitive } from "../src/filter";
import { applyOps, BACKFILL_CAPS, HOOK_CAPS, snapshotOf, validateOps } from "../src/ops";
import { MIN } from "./helpers";

describe("isSensitive", () => {
  for (const s of [
    "key sk-ant-api03-abcdefghijklmnop1234", "ghp_abcdefghijklmnopqrstuvwxyz0123", "xoxb-1234567890-abcdef",
    "AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig", "mail me at a.b@example.com",
    "acct 123456789012", "card 4111 1111 1111 1111", "iban DE89370400440532013000", "hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b",
  ]) test(`drops: ${s}`, () => expect(isSensitive(s)).toBe(true));
  for (const s of [
    "Prefer React Compiler over useMemo", "Use 8px token gap", "Node 18/20/22 support", "Dated 2026-09-23 decision",
    "Prefer Bun for scripts; Volta for Node",
  ]) test(`keeps: ${s}`, () => expect(isSensitive(s)).toBe(false));
});

describe("validateOps", () => {
  const doc = parse(MIN);
  test("accepts well-formed ops", () => {
    const { ok, dropped } = validateOps([
      { op: "add", section: "Personal", text: "Tea" },
      { op: "bump", id: "code_style.1" },
      { op: "replace", id: "code_style.1", text: "Use X always" },
      { op: "log", date: "2026-10-01", tool: "claude", folder: "app", choice: "B", why: "c" },
    ], doc, HOOK_CAPS);
    expect(ok).toHaveLength(4);
    expect(dropped).toEqual([]);
  });
  test("drops bad ops with reasons", () => {
    const { ok, dropped } = validateOps([
      { op: "add", section: "Nope", text: "x" },
      { op: "add", section: "Decision log", text: "x" },
      { op: "add", section: "Personal", text: "" },
      { op: "add", section: "Personal", text: "x".repeat(301) },
      { op: "add", section: "Personal", text: "token sk-ant-api03-abcdefghijklmnop1234" },
      { op: "bump", id: "personal.9" },
      { op: "log", choice: "ok", date: "yesterday" },
      { op: "log", choice: "ok", folder: "a]b" },
      { op: "zap" }, "string", null,
    ], doc, HOOK_CAPS);
    expect(ok).toEqual([]);
    expect(dropped).toHaveLength(11);
  });
  test("caps", () => {
    const adds = Array.from({ length: 7 }, (_, i) => ({ op: "add", section: "Personal", text: `t${i}` }));
    const logs = Array.from({ length: 5 }, (_, i) => ({ op: "log", choice: `c${i}` }));
    const r = validateOps([...adds, ...logs], doc, HOOK_CAPS);
    expect(r.ok.filter((o) => o.op === "add")).toHaveLength(5);
    expect(r.ok.filter((o) => o.op === "log")).toHaveLength(3);
    expect(validateOps([...adds, ...logs], doc, BACKFILL_CAPS).ok).toHaveLength(12);
  });
  test("hidden sections rejected", () => {
    const r = validateOps([{ op: "add", section: "Personal", text: "x" }], doc, HOOK_CAPS, { hidden: (s) => s === "personal" });
    expect(r.ok).toEqual([]);
  });
  test("non-array input", () => expect(validateOps({ nope: 1 }, doc, HOOK_CAPS).ok).toEqual([]));
});

describe("applyOps", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  test("applies all kinds", () => {
    const doc = parse(MIN);
    const snap = snapshotOf(doc);
    const r = applyOps(doc, [
      { op: "add", section: "Personal", text: "Tea" },
      { op: "bump", id: "code_style.1" },
      { op: "log", choice: "Picked B", why: "simple", folder: "app" },
    ], snap, now, "claude");
    expect(r).toEqual({ applied: 3, dropped: [] });
    const md = serialize(doc);
    expect(md).toContain("- Use X (seen 3x, 2026-08..10)");
    expect(md).toContain("- Tea (seen 1x, 2026-10)");
    expect(md).toContain("- 2026-10-05 [claude] [app] Picked B — simple");
  });
  test("stale id after concurrent user edit is dropped, edit survives", () => {
    const before = parse(MIN);
    const snap = snapshotOf(before);
    const edited = parse(MIN.replace("- Use X (seen 2x, 2026-08..09)", "- User rewrote this"));
    const r = applyOps(edited, [{ op: "replace", id: "code_style.1", text: "AI text" }], snap, now);
    expect(r.applied).toBe(0);
    expect(r.dropped[0]).toMatch(/code_style\.1/);
    expect(serialize(edited)).toContain("- User rewrote this");
  });
  test("id resolves by text even if position moved", () => {
    const before = parse(MIN);
    const snap = snapshotOf(before);
    const moved = parse(MIN.replace("<!-- hint: code -->\n", "<!-- hint: code -->\n- New first (seen 1x, 2026-10)\n"));
    expect(applyOps(moved, [{ op: "bump", id: "code_style.1" }], snap, now).applied).toBe(1);
    expect(serialize(moved)).toContain("- Use X (seen 3x, 2026-08..10)");
  });
});
