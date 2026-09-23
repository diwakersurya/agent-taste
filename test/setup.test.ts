import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { type IO, main } from "../src/cli";
import { cloudFolders } from "../src/detect";
import { PRESETS, presetMarkdown } from "../src/presets";
import { paths, readConfig } from "../src/vault";
import { tmpHome } from "./helpers";

let home: string, outs: string[], errs: string[], answers: string[];
const io: IO = {
  out: (s) => outs.push(s), err: (s) => errs.push(s),
  ask: async () => answers.shift() ?? "", stdin: async () => "",
};
const REAL_PATH = process.env.PATH;
afterEach(() => { process.env.PATH = REAL_PATH; });
beforeEach(() => {
  process.env.PATH = "/usr/bin:/bin"; // hide real claude/codex/gemini so detection only sees the temp HOME
  home = tmpHome(); outs = []; errs = []; answers = [];
  fs.mkdirSync(path.join(home, ".claude"));
  fs.mkdirSync(path.join(home, ".gemini"));
  fs.writeFileSync(path.join(home, ".gemini", "GEMINI.md"), "mine\n");
});

test("presets", () => {
  const md = presetMarkdown(PRESETS.developer);
  expect(md).toContain("## Code style\n<!-- hint:");
  expect(md).toContain("## Financial\n<!-- hint: preferences only");
  expect(md).toEndWith("## Decision log\n<!-- newest first: `- YYYY-MM-DD [tool] [folder] choice — why` -->\n");
});

test("cloudFolders finds Google Drive", () => {
  fs.mkdirSync(path.join(home, "Library/CloudStorage/GoogleDrive-a@b.com/My Drive"), { recursive: true });
  expect(cloudFolders(home)).toEqual([{ label: "Google Drive (a@b.com)", path: path.join(home, "Library/CloudStorage/GoogleDrive-a@b.com/My Drive") }]);
});

test("init --yes into dir with space, idempotent, status, uninstall", async () => {
  const dir = path.join(home, "My Drive", "taste");
  expect(await main(["init", "--yes", "--dir", dir], io)).toBe(0);
  expect(fs.realpathSync(path.join(home, ".agent-taste"))).toBe(dir);
  expect(fs.readFileSync(paths(dir).md, "utf8")).toContain("## Code style");
  expect(fs.existsSync(paths(dir).json)).toBe(true);
  const cfg = readConfig(dir);
  expect(cfg.integrations).toMatchObject({ claude: true, gemini: true, chatgpt: false });
  expect(fs.readFileSync(path.join(home, ".claude/CLAUDE.md"), "utf8")).toContain("@~/.agent-taste/taste.md");
  expect(JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")).hooks.SessionEnd).toHaveLength(1);

  const snapshot = fs.readFileSync(path.join(home, ".gemini/GEMINI.md"), "utf8");
  expect(await main(["init", "--yes", "--dir", dir], io)).toBe(0);
  expect(fs.readFileSync(path.join(home, ".gemini/GEMINI.md"), "utf8")).toBe(snapshot);

  outs = [];
  expect(await main(["status"], io)).toBe(0);
  expect(outs.join("\n")).toMatch(/Claude Code\s+installed/);

  expect(await main(["uninstall", "--yes"], io)).toBe(0);
  expect(fs.readFileSync(path.join(home, ".gemini/GEMINI.md"), "utf8")).toBe("mine\n");
  expect(fs.existsSync(path.join(home, ".claude/CLAUDE.md"))).toBe(false);
  expect(fs.existsSync(path.join(home, ".agent-taste"))).toBe(false);
  expect(fs.existsSync(paths(dir).md)).toBe(true);
});

test("init keeps existing taste.md untouched", async () => {
  const dir = path.join(home, "v");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "taste.md"), "# Mine\n\n## Only\n- x\n");
  await main(["init", "--yes", "--dir", dir], io);
  expect(fs.readFileSync(path.join(dir, "taste.md"), "utf8")).toBe("# Mine\n\n## Only\n- x\n");
});

test("init --no-hook", async () => {
  const dir = path.join(home, "v");
  await main(["init", "--yes", "--no-hook", "--dir", dir], io);
  expect(readConfig(dir).hook.enabled).toBe(false);
  expect(fs.existsSync(path.join(home, ".claude/settings.json"))).toBe(false);
});

test("interactive init: pick custom dir, preset, integrations", async () => {
  const dir = path.join(home, "picked");
  answers = [dir, "general", "y", "n", "y"]; // dir, preset, claude?, gemini?, hook?
  expect(await main(["init"], io)).toBe(0);
  expect(fs.readFileSync(paths(dir).md, "utf8")).toContain("## Work style");
  expect(readConfig(dir).integrations).toMatchObject({ claude: true, gemini: false });
});

test("refuses when ~/.agent-taste is a real directory", async () => {
  fs.mkdirSync(path.join(home, ".agent-taste"));
  expect(await main(["init", "--yes", "--dir", path.join(home, "v")], io)).toBe(1);
  expect(errs.join()).toMatch(/not a symlink/);
});

test("uninstall --purge deletes the vault", async () => {
  const dir = path.join(home, "v");
  await main(["init", "--yes", "--dir", dir], io);
  expect(await main(["uninstall", "--purge", "--yes"], io)).toBe(0);
  expect(fs.existsSync(dir)).toBe(false);
});
