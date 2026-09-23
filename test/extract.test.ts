import { expect, test } from "bun:test";
import { extractFile, renderSessions } from "../src/extract";

const f = (n: string) => new URL(`./fixtures/${n}`, import.meta.url).pathname;

test("claude", () => {
  expect(extractFile(f("claude.jsonl"))).toEqual({
    tool: "claude", date: "2026-09-22", cwd: "/home/u/code/app",
    messages: ["Build a menubar app", 'Your questions have been answered: "Where?"="Floating shelf"', "you dont need to write name label"],
  });
});
test("codex old", () =>
  expect(extractFile(f("codex-old.jsonl"))).toMatchObject({ tool: "codex", date: "2025-08-29", messages: ["explain this codebase"] }));
test("codex new", () =>
  expect(extractFile(f("codex-new.jsonl"))).toMatchObject({ tool: "codex", date: "2026-03-12", cwd: "/home/u/code/copy", messages: ["keep node config in the side panel"] }));
test("gemini", () =>
  expect(extractFile(f("gemini.json"))).toMatchObject({ tool: "gemini", date: "2025-10-23", messages: ["analyse this file"] }));
test("missing / garbage file returns null", () => {
  expect(extractFile("/nope/x.jsonl")).toBeNull();
  expect(extractFile(f("fake-engine.sh"))).toBeNull();
});
test("render", () =>
  expect(renderSessions([{ tool: "codex", date: "2026-01-01", cwd: "/a", messages: ["one\ntwo", "three"] }]))
    .toBe("\n## codex 2026-01-01 /a\n> one\n> two\n> three\n"));
