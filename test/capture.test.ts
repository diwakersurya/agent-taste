import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildPrompt, captureText, captureTranscript, engineArgv, parseOps, runEngine } from "../src/capture";
import { parse } from "../src/doc";
import { HOOK_CAPS } from "../src/ops";
import { defaultConfig, paths, readConfig, writeConfig } from "../src/vault";
import { makeVault, MIN, tmpHome } from "./helpers";

const FAKE = new URL("./fixtures/fake-engine.sh", import.meta.url).pathname;
let home: string, vault: string, out: string;

beforeEach(() => {
  home = tmpHome();
  vault = makeVault(home);
  writeConfig(vault, { ...defaultConfig(vault), engine: FAKE });
  out = path.join(home, "engine-out.txt");
  process.env.FAKE_OUT = out;
  delete process.env.FAKE_SLEEP; delete process.env.FAKE_FAIL;
  process.env.FAKE_PROMPT = path.join(home, "prompt.txt");
});

test("engineArgv", () => {
  const c = defaultConfig("/v");
  expect(engineArgv({ ...c, engine: "/x/eng" })).toEqual(["/x/eng"]);
  expect(engineArgv(c, (b) => (b === "codex" ? "/bin/codex" : null))).toEqual(["/bin/codex", "exec", "-"]);
  expect(engineArgv(c, (b) => (b === "claude" ? "/bin/claude" : null))).toEqual([
    "/bin/claude", "-p", "--model", "sonnet", "--no-session-persistence", "--output-format", "text"]);
  expect(engineArgv(c, () => null)).toBeNull();
});

test("parseOps tolerates prose and fences", () => {
  expect(parseOps('Sure!\n```json\n{"ops":[{"op":"bump","id":"a.1"}]}\n```\nDone {x}')).toEqual([{ op: "bump", id: "a.1" }]);
  expect(() => parseOps("no json here")).toThrow(/no \{"ops"/);
});

test("buildPrompt lists ids, hints, marker", () => {
  const p = buildPrompt(parse(MIN), "\n## claude x\n> hello\n");
  expect(p.startsWith("<agent-taste-capture/>")).toBe(true);
  expect(p).toContain("[code_style.1] Use X (seen 2x, 2026-08..09)");
  expect(p).toContain("### personal — Personal (hint: life)");
  expect(p).toContain("> hello");
});

test("runEngine timeout kills and rejects", async () => {
  process.env.FAKE_SLEEP = "3";
  fs.writeFileSync(out, "{}");
  await expect(runEngine([FAKE], "x", 300)).rejects.toThrow(/timed out/);
});

test("runEngine passes recursion guard env", async () => {
  const probe = path.join(home, "probe.sh");
  fs.writeFileSync(probe, "#!/bin/sh\ncat >/dev/null\necho \"$AGENT_TASTE_CAPTURE\"\n", { mode: 0o755 });
  expect((await runEngine([probe], "x")).trim()).toBe("1");
});

test("captureText applies filtered ops and logs", async () => {
  fs.writeFileSync(out, JSON.stringify({ ops: [
    { op: "add", section: "Personal", text: "Tea over coffee" },
    { op: "add", section: "Personal", text: "key sk-ant-api03-abcdefghijklmnop1234" },
    { op: "log", choice: "Chose Bun", why: "fast", folder: "app" },
  ] }));
  const r = await captureText(vault, "> msgs", { caps: HOOK_CAPS, source: "t", tool: "claude", now: new Date("2026-10-05T00:00:00Z") });
  expect(r.applied).toBe(2);
  expect(r.dropped).toHaveLength(1);
  const md = fs.readFileSync(paths(vault).md, "utf8");
  expect(md).toContain("- Tea over coffee (seen 1x, 2026-10)");
  expect(md).not.toContain("sk-ant");
  expect(md).toContain("- 2026-10-05 [claude] [app] Chose Bun — fast");
  expect(fs.existsSync(paths(vault).json)).toBe(true);
  expect(fs.readFileSync(paths(vault).log, "utf8")).toMatch(/t engine=fake-engine.sh applied=2 dropped=1/);
});

test("dryRun applies nothing", async () => {
  fs.writeFileSync(out, JSON.stringify({ ops: [{ op: "add", section: "Personal", text: "Tea" }] }));
  const r = await captureText(vault, "> m", { caps: HOOK_CAPS, source: "t", dryRun: true });
  expect(r.ops).toHaveLength(1);
  expect(fs.readFileSync(paths(vault).md, "utf8")).toBe(MIN);
});

test("user edit during engine run survives", async () => {
  process.env.FAKE_SLEEP = "1";
  fs.writeFileSync(out, JSON.stringify({ ops: [{ op: "replace", id: "code_style.1", text: "AI rewrite" }] }));
  const p = captureText(vault, "> m", { caps: HOOK_CAPS, source: "t" });
  await Bun.sleep(300);
  fs.writeFileSync(paths(vault).md, MIN.replace("- Use X (seen 2x, 2026-08..09)", "- Mine now"));
  const r = await p;
  expect(r.applied).toBe(0);
  expect(fs.readFileSync(paths(vault).md, "utf8")).toContain("- Mine now");
});

test("malformed engine output applies nothing and logs", async () => {
  fs.writeFileSync(out, "I think you like tea.");
  await expect(captureText(vault, "> m", { caps: HOOK_CAPS, source: "t" })).rejects.toThrow();
  expect(fs.readFileSync(paths(vault).md, "utf8")).toBe(MIN);
});

test("captureTranscript skips short sessions", async () => {
  const t = new URL("./fixtures/codex-new.jsonl", import.meta.url).pathname;
  await captureTranscript(vault, t);
  expect(fs.readFileSync(paths(vault).log, "utf8")).toMatch(/skip .*codex-new\.jsonl/);
  expect(readConfig(vault).hook.minChars).toBe(400);
});
