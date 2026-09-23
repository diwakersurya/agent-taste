import fs from "node:fs";
import { hashToken, newToken } from "../mcp";
import { readConfig, resolveVault, writeConfig } from "../vault";
import type { Integration } from "./blocks";

export function rotateToken(vault: string): string {
  const t = newToken();
  const cfg = readConfig(vault);
  cfg.remote.tokenHash = hashToken(t);
  cfg.integrations.chatgpt = true;
  writeConfig(vault, cfg);
  return t;
}

// Source: developers.openai.com/api/docs/guides/secure-mcp-tunnels (checked 2026-09-23).
// tunnel-client forwards to a local URL we give it, so the token rides in the URL path
// and never needs a ChatGPT-side auth setting.
export const GUIDE = (token: string, port: number) => `ChatGPT setup (developer mode; Plus/Pro, or Enterprise/Edu with admin approval)

Your connector token (shown once; it is part of the local URL below):
  ${token}

1. Start the local server and keep it running:
     npx agent-taste mcp --http --port ${port}

2. Create a tunnel at https://platform.openai.com/settings/organization/tunnels
   (needs Tunnels Read + Manage) and copy its tunnel_id.

3. Install tunnel-client from https://github.com/openai/tunnel-client/releases/latest, then:
     export CONTROL_PLANE_API_KEY="sk-..."   # a Platform key with Tunnels Read + Use
     tunnel-client init --sample sample_mcp_stdio_local --profile agent-taste \\
       --tunnel-id <tunnel_id> \\
       --mcp-server-url http://127.0.0.1:${port}/mcp/${token}
     tunnel-client doctor --profile agent-taste --explain
     tunnel-client run --profile agent-taste

4. In ChatGPT: https://chatgpt.com/plugins → + (developer-mode app) → Connection: Tunnel →
   pick your tunnel. Test in a chat: "Use agent-taste read_taste".

Security: the server listens on 127.0.0.1 only and the tunnel is outbound-only.
Financial and Personal are hidden remotely (config remote.excludeSections); tools
are read + append-only, limited to 30 writes/hour. Rotate the token any time with
  npx agent-taste mcp --rotate-token
then re-run step 3's init with the new URL.`;

export const integration: Integration = {
  id: "chatgpt", label: "ChatGPT desktop (remote MCP via tunnel)",
  detect: () => process.platform === "darwin" && fs.existsSync("/Applications/ChatGPT.app"),
  installed: () => { try { return !!readConfig(resolveVault()).remote.tokenHash; } catch { return false; } },
  install: () => {},
  remove: () => {
    try {
      const v = resolveVault();
      const cfg = readConfig(v);
      cfg.remote.tokenHash = null;
      cfg.integrations.chatgpt = false;
      writeConfig(v, cfg);
    } catch {}
  },
};
