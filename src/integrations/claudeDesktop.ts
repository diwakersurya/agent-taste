import fs from "node:fs";
import path from "node:path";
import { type Ctx, editJson, type Integration } from "./blocks";

export const desktopConfigFile = (ctx: Ctx) =>
  process.platform === "darwin"
    ? path.join(ctx.home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : path.join(ctx.home, ".config", "Claude", "claude_desktop_config.json");

const read = (ctx: Ctx) => { try { return JSON.parse(fs.readFileSync(desktopConfigFile(ctx), "utf8")); } catch { return {}; } };

export const integration: Integration = {
  id: "claudeDesktop", label: "Claude Desktop (MCP)",
  detect: (ctx) => fs.existsSync(path.dirname(desktopConfigFile(ctx))),
  installed: (ctx) => !!read(ctx).mcpServers?.["taste-profile"],
  install: (ctx) => editJson(desktopConfigFile(ctx), (o) => {
    o.mcpServers ??= {};
    o.mcpServers["taste-profile"] = { command: ctx.node, args: [ctx.bin, "mcp"] };
  }),
  remove: (ctx) => editJson(desktopConfigFile(ctx), (o) => {
    if (!o.mcpServers) return;
    delete o.mcpServers["taste-profile"];
    if (!Object.keys(o.mcpServers).length) delete o.mcpServers;
  }),
};
