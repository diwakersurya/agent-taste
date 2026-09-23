import { expect, test } from "bun:test";
import fs from "node:fs";
import { parse } from "../src/doc";
import { toJson } from "../src/json";

const FIX = fs.readFileSync(new URL("./fixtures/taste.md", import.meta.url), "utf8");

test("shape", () => {
  const j = toJson(parse(FIX), new Date("2026-09-23T04:53:00Z"));
  expect(j.schema).toBe(1);
  expect(j.generated_at).toBe("2026-09-23T04:53:00+00:00");
  expect(Object.keys(j.sections)).toEqual(["code_style", "tooling_workflow", "financial", "personal"]);
  expect(j.sections.code_style.preferences[0]).toEqual({
    id: "code_style.1", text: "Extract reusable logic into custom hooks under `hooks/`", seen: 4, seen_plus: false, first: "2026-08", last: "2026-09" });
  expect(j.sections.financial.hint).toStartWith("preferences & principles only");
  expect(j.sections.financial.preferences).toEqual([]);
  expect(j.decisions).toHaveLength(4);
  expect(j.decisions[3]).toEqual({ date: null, tool: "claude", folder: "unknown", choice: "Legacy entry", why: "kept" });
});
