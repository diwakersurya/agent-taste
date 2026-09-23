import { describe, expect, test } from "bun:test";
import {
  addDecision, addPref, addSection, byId, decisions, DocError, entries, formatPref, parse,
  removeSection, renameSection, serialize, setHint,
} from "../src/doc";

const MD = "# T\n\n## Code style\n<!-- hint: code -->\n- Use X (seen 2x, 2026-08..09)\n\n## Personal\n<!-- hint: life -->\n\n## Decision log\n<!-- newest first -->\n- 2026-09-01 [claude] [app] Chose A — fast\n";

describe("formatPref", () => {
  test("same-year range is shortened", () =>
    expect(formatPref({ text: "A", seen: 3, plus: false, first: "2026-08", last: "2026-09" })).toBe("- A (seen 3x, 2026-08..09)"));
  test("cross-year range is full", () =>
    expect(formatPref({ text: "A", seen: 2, plus: false, first: "2025-11", last: "2026-01" })).toBe("- A (seen 2x, 2025-11..2026-01)"));
  test("no evidence", () => expect(formatPref({ text: "A", seen: null, plus: false, first: null, last: null })).toBe("- A"));
});

describe("sections", () => {
  test("add goes before Decision log with blank line", () => {
    const d = parse(MD);
    addSection(d, "Health & fitness", { hint: "exercise prefs" });
    expect(serialize(d)).toBe(MD.replace("## Decision log", "## Health & fitness\n<!-- hint: exercise prefs -->\n\n## Decision log"));
  });
  test("add --after", () => {
    const d = parse(MD);
    addSection(d, "Z", { after: "Code style" });
    expect(d.sections.map((s) => s.slug)).toEqual(["code_style", "z", "personal", "decision_log"]);
  });
  test("add to doc without trailing blank line inserts one", () => {
    const d = parse("# T\n## A\n- x");
    addSection(d, "B");
    expect(serialize(d)).toBe("# T\n## A\n- x\n\n## B\n");
  });
  test("duplicate slug refused", () => expect(() => addSection(parse(MD), "code-style")).toThrow(DocError));
  test("reserved refused", () => {
    expect(() => addSection(parse(MD), "Decision log")).toThrow(DocError);
    expect(() => addSection(parse(MD), "Archived")).toThrow(DocError);
  });
  test("rename", () => {
    const d = parse(MD);
    renameSection(d, "Code style", "Coding");
    expect(serialize(d)).toContain("## Coding\n<!-- hint: code -->");
    expect(() => renameSection(d, "Coding", "Personal")).toThrow(DocError);
  });
  test("setHint replaces or inserts", () => {
    const d = parse(MD);
    setHint(d, "Code style", "new");
    setHint(d, "Decision log", "ignored? no, replaced");
    expect(serialize(d)).toContain("## Code style\n<!-- hint: new -->\n- Use X");
    const e = parse("## A\n- x\n");
    setHint(e, "A", "h");
    expect(serialize(e)).toBe("## A\n<!-- hint: h -->\n- x\n");
  });
  test("remove refuses non-empty, archives, forces", () => {
    expect(() => removeSection(parse(MD), "Code style", "refuse")).toThrow(/1 entr/);
    const a = parse(MD);
    removeSection(a, "Code style", "archive");
    expect(serialize(a)).not.toContain("## Code style");
    expect(serialize(a)).toContain("## Archived\n");
    expect(serialize(a)).toContain("- [Code style] Use X (seen 2x, 2026-08..09)");
    const f = parse(MD);
    removeSection(f, "Code style", "force");
    expect(serialize(f)).not.toContain("Use X");
    const e = parse(MD);
    removeSection(e, "Personal", "refuse");
    expect(serialize(e)).not.toContain("Personal");
    expect(() => removeSection(parse(MD), "Decision log", "force")).toThrow(DocError);
  });
});

describe("entries", () => {
  test("ids are section.n", () => expect(entries(parse(MD)).map((e) => e.id)).toEqual(["code_style.1"]));
  test("addPref new then bump", () => {
    const d = parse(MD);
    expect(addPref(d, "Personal", "Morning runs", "2026-10")).toEqual({ id: "personal.1", bumped: false });
    expect(serialize(d)).toContain("<!-- hint: life -->\n- Morning runs (seen 1x, 2026-10)\n");
    expect(addPref(d, "personal", "morning  RUNS!", "2026-11")).toEqual({ id: "personal.1", bumped: true });
    expect(byId(d, "personal.1")!.pref.raw).toBe("- Morning runs (seen 2x, 2026-10..11)");
  });
  test("addPref appends after last pref", () => {
    const d = parse(MD);
    addPref(d, "Code style", "Use Y", "2026-10");
    expect(serialize(d)).toContain("- Use X (seen 2x, 2026-08..09)\n- Use Y (seen 1x, 2026-10)\n\n## Personal");
  });
  test("addPref into Decision log refused, unknown section refused", () => {
    expect(() => addPref(parse(MD), "Decision log", "x", "2026-10")).toThrow(DocError);
    expect(() => addPref(parse(MD), "Nope", "x", "2026-10")).toThrow(DocError);
  });
  test("bump preserves text and keeps later day-precision last", () => {
    const d = parse("## A\n- x (seen 1x, 2026-09-07)\n");
    addPref(d, "A", "x", "2026-09");
    expect(serialize(d)).toBe("## A\n- x (seen 2x, 2026-09-07)\n");
  });
  test("CRLF docs get CRLF new lines", () => {
    const d = parse(MD.replace(/\n/g, "\r\n"));
    addPref(d, "Personal", "Z", "2026-10");
    addSection(d, "New");
    expect(serialize(d).replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("decisions", () => {
  test("newest first, after comment", () => {
    const d = parse(MD);
    addDecision(d, { date: "2026-10-02", tool: "cli", folder: "x", choice: "Picked B", why: "simpler" });
    expect(serialize(d)).toContain("<!-- newest first -->\n- 2026-10-02 [cli] [x] Picked B — simpler\n- 2026-09-01");
    expect(decisions(d)[0].choice).toBe("Picked B");
  });
  test("creates Decision log if missing", () => {
    const d = parse("# T\n\n## A\n- x\n");
    addDecision(d, { date: "2026-10-02", tool: "cli", folder: "~", choice: "C", why: null });
    expect(serialize(d)).toEndWith("## Decision log\n<!-- newest first: `- YYYY-MM-DD [tool] [folder] choice — why` -->\n- 2026-10-02 [cli] [~] C\n");
  });
});
