import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { hintOf, parse, parseDecision, parsePref, serialize, slug } from "../src/doc";

const FIX = fs.readFileSync(new URL("./fixtures/taste.md", import.meta.url), "utf8");

describe("round trip", () => {
  test("fixture is byte-identical", () => expect(serialize(parse(FIX))).toBe(FIX));
  test("CRLF is byte-identical", () => {
    const crlf = FIX.replace(/\n/g, "\r\n");
    expect(serialize(parse(crlf))).toBe(crlf);
  });
  test("no trailing newline", () => expect(serialize(parse("# a\n## B\n- x"))).toBe("# a\n## B\n- x"));
  test("empty string", () => expect(serialize(parse(""))).toBe(""));
});

describe("structure", () => {
  const doc = parse(FIX);
  test("sections and slugs", () =>
    expect(doc.sections.map((s) => s.slug)).toEqual(["code_style", "tooling_workflow", "financial", "personal", "decision_log"]));
  test("CRLF headings have clean titles", () =>
    expect(parse("## Code style\r\n- a\r\n").sections[0].title).toBe("Code style"));
  test("hints", () => {
    expect(hintOf(doc.sections[2])).toStartWith("preferences & principles only");
    expect(hintOf(doc.sections[0])).toBeNull();
    expect(hintOf(parse("## A\n<!-- hint: code things -->\n").sections[0])).toBe("code things");
  });
  test("nested bullet is opaque", () =>
    expect(doc.sections[0].items[3]).toEqual({ kind: "other", raw: "  - nested sub-bullet stays opaque" }));
  test("slug", () => expect(slug("UI / visual design")).toBe("ui_visual_design"));
});

describe("evidence", () => {
  test("range in same year", () =>
    expect(parsePref("- Use X (seen 4x, 2026-08..09)")).toMatchObject({ text: "Use X", seen: 4, plus: false, first: "2026-08", last: "2026-09" }));
  test("plus", () => expect(parsePref("- A (seen 10x+, 2026-03..09)")).toMatchObject({ seen: 10, plus: true }));
  test("single month", () => expect(parsePref("- A (seen 1x, 2026-03)")).toMatchObject({ first: "2026-03", last: "2026-03" }));
  test("no date", () => expect(parsePref("- A (seen 5x)")).toMatchObject({ seen: 5, first: null, last: null }));
  test("cross year", () => expect(parsePref("- A (seen 2x, 2025-11..2026-01)")).toMatchObject({ first: "2025-11", last: "2026-01" }));
  test("none", () => expect(parsePref("- A plain")).toMatchObject({ text: "A plain", seen: null }));
});

describe("decisions", () => {
  test("full", () =>
    expect(parseDecision("- 2026-09-22 [claude] [mac-app] Metadata-only — privacy")).toMatchObject({
      date: "2026-09-22", tool: "claude", folder: "mac-app", choice: "Metadata-only", why: "privacy" }));
  test("month + no why", () =>
    expect(parseDecision("- 2026-08 [codex] [~] No why")).toMatchObject({ date: "2026-08", why: null, choice: "No why" }));
  test("undated", () => expect(parseDecision("- undated [claude] [x] Y — z")).toMatchObject({ date: null, tool: "claude" }));
  test("unparseable keeps text", () => expect(parseDecision("- freeform")).toMatchObject({ date: null, choice: "freeform" }));
});
