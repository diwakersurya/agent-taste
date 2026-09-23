import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { editJson, hasBlock, IntegrationError, makeCtx, removeBlock, upsertBlock } from "../src/integrations/blocks";
import { integration as claude, setHook, settingsFile } from "../src/integrations/claude";
import { desktopConfigFile, integration as desktop } from "../src/integrations/claudeDesktop";
import { integration as codex } from "../src/integrations/codex";
import { integration as gemini } from "../src/integrations/gemini";
import { cleanLegacy } from "../src/integrations/legacy";
import { defaultConfig } from "../src/vault";
import { makeVault, tmpHome } from "./helpers";

let home: string;
beforeEach(() => { home = tmpHome(); makeVault(home); });
const w = (rel: string, s: string) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); return f; };
const r = (f: string) => fs.readFileSync(f, "utf8");

describe("blocks", () => {
  for (const orig of ["", "abc", "abc\n", "a\n\nb\n"]) test(`install→remove identity for ${JSON.stringify(orig)}`, () => {
    const f = w("x.md", orig);
    upsertBlock(f, "body");
    upsertBlock(f, "body");
    expect(r(f).match(/agent-taste:start/g)).toHaveLength(1);
    removeBlock(f);
    expect(r(f)).toBe(orig);
  });
  test("created file is deleted on remove", () => {
    const f = path.join(home, "new", "x.md");
    upsertBlock(f, "body");
    expect(hasBlock(f)).toBe(true);
    removeBlock(f);
    expect(fs.existsSync(f)).toBe(false);
  });
  test("backup written once", () => {
    const f = w("x.md", "orig");
    upsertBlock(f, "1"); upsertBlock(f, "2");
    expect(r(f + ".bak-agent-taste")).toBe("orig");
  });
  test("editJson keeps indent, refuses invalid JSON", () => {
    const f = w("c.json", '{\n    "a": 1\n}\n');
    editJson(f, (o) => { o.b = 2; });
    expect(r(f)).toBe('{\n    "a": 1,\n    "b": 2\n}\n');
    editJson(f, (o) => { delete o.b; });
    expect(r(f)).toBe('{\n    "a": 1\n}\n');
    const bad = w("bad.json", "{nope");
    expect(() => editJson(bad, (o) => { o.x = 1; })).toThrow(IntegrationError);
    expect(r(bad)).toBe("{nope");
  });
});

describe("tools", () => {
  const cfg = defaultConfig("/v");
  test("claude: import uses ~/.agent-taste, hook added and removed", () => {
    const ctx = makeCtx(home);
    const md = w(".claude/CLAUDE.md", "mine\n");
    const settings = w(".claude/settings.json", JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "other" }] }] } }, null, 2) + "\n");
    const before = JSON.parse(r(settings));
    claude.install(ctx, cfg);
    expect(r(md)).toContain("@~/.agent-taste/taste.md");
    expect(r(md)).not.toContain("My Drive");
    const s = JSON.parse(r(settingsFile(ctx)));
    expect(s.hooks.SessionEnd).toHaveLength(2);
    expect(s.hooks.SessionEnd[1].hooks[0].command).toBe(`node "${home}/.agent-taste/bin/agent-taste.js" capture --stdin`);
    claude.install(ctx, cfg);
    expect(JSON.parse(r(settings)).hooks.SessionEnd).toHaveLength(2);
    claude.remove(ctx);
    expect(r(md)).toBe("mine\n");
    expect(JSON.parse(r(settings))).toEqual(before);
  });
  test("claude: hook off removes only ours, cleans empty keys", () => {
    const ctx = makeCtx(home);
    const settings = w(".claude/settings.json", '{\n  "theme": "dark"\n}\n');
    setHook(ctx, true);
    setHook(ctx, false);
    expect(r(settings)).toBe('{\n  "theme": "dark"\n}\n');
  });
  test("gemini and codex use absolute symlink path", () => {
    const ctx = makeCtx(home);
    gemini.install(ctx, cfg);
    codex.install(ctx, cfg);
    expect(r(path.join(home, ".gemini/GEMINI.md"))).toContain(`@${home}/.agent-taste/taste.md`);
    expect(r(path.join(home, ".codex/AGENTS.md"))).toContain(`read ${home}/.agent-taste/taste.md`);
    gemini.remove(ctx); codex.remove(ctx);
    expect(fs.existsSync(path.join(home, ".gemini/GEMINI.md"))).toBe(false);
  });
  test("claude desktop mcp entry", () => {
    const ctx = makeCtx(home);
    const f = desktopConfigFile(ctx);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { other: { command: "x" } }, preferences: { a: 1 } }, null, 2) + "\n");
    const before = JSON.parse(r(f));
    desktop.install(ctx, cfg);
    expect(JSON.parse(r(f)).mcpServers["agent-taste"]).toEqual({ command: ctx.node, args: [ctx.bin, "mcp"] });
    expect(desktop.installed(ctx)).toBe(true);
    desktop.remove(ctx);
    expect(JSON.parse(r(f))).toEqual(before);
  });
});

describe("legacy cleanup", () => {
  const BLOCK = "<!-- taste-log:start -->\n# Personal taste log\nrule\n<!-- taste-log:end -->\n";
  test("removes hand-made blocks, keeps user content", () => {
    const c = w(".claude/CLAUDE.md", `@~/AI-Vault/taste.md\n\n${BLOCK}`);
    const g = w(".gemini/GEMINI.md", `<!-- nodeterm:x:end -->\n\n@/Users/me/AI-Vault/taste.md\n\n${BLOCK}`);
    const x = w(".codex/AGENTS.md", `be concise\n<!-- nodeterm:end -->\n\n${BLOCK}At session start, read ~/AI-Vault/taste.md before doing anything else.\n`);
    const s = w(".claude/settings.json", JSON.stringify({ hooks: { SessionEnd: [
      { hooks: [{ type: "command", command: "keep" }] },
      { hooks: [{ type: "command", command: 'bash "$HOME/AI-Vault/_tools/taste_hook.sh"', timeout: 10 }] },
    ] } }, null, 2) + "\n");
    const ctx = makeCtx(home);
    const d = desktopConfigFile(ctx);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.writeFileSync(d, JSON.stringify({ mcpServers: { webmcp: { command: "npx" }, "ai-vault": { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/x/AI-Vault"] } } }, null, 2) + "\n");
    expect(cleanLegacy(ctx).sort()).toEqual([c, g, x, s, d].sort());
    expect(r(c)).toBe("");
    expect(r(g)).toBe("<!-- nodeterm:x:end -->\n");
    expect(r(x)).toBe("be concise\n<!-- nodeterm:end -->\n");
    expect(JSON.parse(r(s)).hooks.SessionEnd).toHaveLength(1);
    expect(Object.keys(JSON.parse(r(d)).mcpServers)).toEqual(["webmcp"]);
    expect(cleanLegacy(ctx)).toEqual([]);
  });
});
