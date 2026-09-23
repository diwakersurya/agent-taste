import type { Integration } from "./blocks";
import { integration as chatgpt } from "./chatgpt";
import { integration as claude } from "./claude";
import { integration as claudeDesktop } from "./claudeDesktop";
import { integration as codex } from "./codex";
import { integration as gemini } from "./gemini";

export const INTEGRATIONS: Integration[] = [claude, gemini, codex, claudeDesktop, chatgpt];

const ALIASES: Record<string, string> = { "claude-desktop": "claudeDesktop", desktop: "claudeDesktop" };

export function getIntegration(id: string): Integration {
  const found = INTEGRATIONS.find((i) => i.id === (ALIASES[id] ?? id));
  if (!found) throw new Error(`Unknown integration "${id}". Choose: claude, gemini, codex, claude-desktop, chatgpt`);
  return found;
}
