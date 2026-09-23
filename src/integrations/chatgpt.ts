import fs from "node:fs";
import type { Integration } from "./blocks";

export const integration: Integration = {
  id: "chatgpt", label: "ChatGPT desktop (remote MCP via tunnel)",
  detect: () => process.platform === "darwin" && fs.existsSync("/Applications/ChatGPT.app"),
  installed: () => false,
  install: () => {},
  remove: () => {},
};
