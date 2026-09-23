import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { main, type IO } from "../src/cli";
import { paths, readConfig } from "../src/vault";
import { makeVault, tmpHome } from "./helpers";

let home: string, vault: string, outs: string[], errs: string[];
const io: IO = {
  out: (s) => outs.push(s), err: (s) => errs.push(s),
  ask: async () => "", stdin: async () => "",
};
beforeEach(() => { home = tmpHome(); vault = makeVault(home); outs = []; errs = []; });
const md = () => fs.readFileSync(paths(vault).md, "utf8");

test("section add/list/rename/hint/remove", async () => {
  expect(await main(["section", "add", "Health & fitness", "--hint", "exercise"], io)).toBe(0);
  expect(md()).toContain("## Health & fitness\n<!-- hint: exercise -->");
  await main(["section", "list"], io);
  expect(outs.join("\n")).toMatch(/Health & fitness\s+0 entries\s+exercise/);
  await main(["section", "rename", "Health & fitness", "Health"], io);
  await main(["section", "hint", "Health", "diet too"], io);
  expect(md()).toContain("## Health\n<!-- hint: diet too -->");
  await main(["section", "remove", "Health"], io);
  expect(md()).not.toContain("## Health");
  expect(JSON.parse(fs.readFileSync(paths(vault).json, "utf8")).sections.health).toBeUndefined();
});

test("remove non-empty needs flag", async () => {
  expect(await main(["section", "remove", "Code style"], io)).toBe(1);
  expect(errs.join()).toMatch(/--archive or --force/);
  expect(await main(["section", "remove", "Code style", "--archive"], io)).toBe(0);
  expect(md()).toContain("## Archived");
});

test("add + log + show + search", async () => {
  await main(["add", "Tea over coffee", "-s", "Personal"], io);
  expect(md()).toMatch(/- Tea over coffee \(seen 1x, \d{4}-\d{2}\)/);
  await main(["log", "Chose Bun", "--why", "fast", "--folder", "app", "--date", "2026-10-01"], io);
  expect(md()).toContain("- 2026-10-01 [cli] [app] Chose Bun — fast");
  outs = [];
  await main(["show", "Personal"], io);
  expect(outs.join("\n")).toContain("## Personal");
  expect(outs.join("\n")).not.toContain("## Code style");
  outs = [];
  await main(["search", "bun"], io);
  expect(outs.join("\n")).toContain("[log] 2026-10-01 Chose Bun — fast");
});

test("add rejects secrets", async () => {
  expect(await main(["add", "my key sk-ant-api03-abcdefghijklmnop1234", "-s", "Personal"], io)).toBe(1);
  expect(md()).not.toContain("sk-ant");
});

test("config get/set and hook toggle", async () => {
  await main(["config", "set", "hook.model", "haiku"], io);
  expect(readConfig(vault).hook.model).toBe("haiku");
  await main(["config", "set", "hook.minChars", "100"], io);
  expect(readConfig(vault).hook.minChars).toBe(100);
  outs = [];
  await main(["config", "get", "hook.model"], io);
  expect(outs).toEqual(["haiku"]);
  await main(["hook", "off"], io);
  expect(readConfig(vault).hook.enabled).toBe(false);
  expect(await main(["config", "set", "remote.tokenHash", "x"], io)).toBe(1);
});

test("unknown command and missing vault", async () => {
  expect(await main(["wat"], io)).toBe(1);
  fs.rmSync(path.join(home, ".taste-profile"));
  expect(await main(["show"], io)).toBe(1);
  expect(errs.join()).toMatch(/npx taste-profile init/);
});

test("--help", async () => {
  expect(await main(["--help"], io)).toBe(0);
  expect(outs.join("\n")).toContain("taste-profile section add");
});
