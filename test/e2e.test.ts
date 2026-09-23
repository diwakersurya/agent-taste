import { beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIST = path.resolve("dist/agent-taste.js");
beforeAll(() => { execFileSync("bun", ["run", "build"], { stdio: "ignore" }); });

test("bundled CLI runs under node: init, add, status, uninstall", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-e2e-")));
  fs.mkdirSync(path.join(home, ".claude"));
  const env = { ...process.env, HOME: home };
  const run = (...a: string[]) => spawnSync("node", [DIST, ...a], { env, encoding: "utf8" });
  expect(run("--version").stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  const dir = path.join(home, "My Drive", "taste");
  const init = run("init", "--yes", "--dir", dir);
  expect(init.status).toBe(0);
  expect(fs.existsSync(path.join(dir, "bin", "agent-taste.js"))).toBe(true);
  expect(run("add", "Prefer tabs", "-s", "Code style").status).toBe(0);
  expect(fs.readFileSync(path.join(dir, "taste.md"), "utf8")).toContain("- Prefer tabs (seen 1x");
  const hook = spawnSync("node", [path.join(home, ".agent-taste", "bin", "agent-taste.js"), "capture", "--stdin"], { env, input: '{"transcript_path":"/nope"}', encoding: "utf8" });
  expect(hook.status).toBe(0);
  expect(run("status").stdout).toContain("Claude Code");
  expect(run("uninstall", "--yes").status).toBe(0);
  expect(fs.existsSync(path.join(home, ".claude", "CLAUDE.md"))).toBe(false);
});
