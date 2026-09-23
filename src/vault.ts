import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Doc, parse, serialize } from "./doc";
import { toJson } from "./json";

export class VaultError extends Error {}

export const home = () => process.env.HOME || os.homedir();
export const linkPath = () => path.join(home(), ".taste-profile");

export type Config = {
  version: 1;
  vault: string;
  hook: { enabled: boolean; model: string; minChars: number };
  engine: string;
  integrations: { claude: boolean; gemini: boolean; codex: boolean; claudeDesktop: boolean; chatgpt: boolean };
  remote: { tokenHash: string | null; excludeSections: string[]; readOnly: boolean; writesPerHour: number };
};

export const defaultConfig = (vault: string): Config => ({
  version: 1, vault,
  hook: { enabled: true, model: "sonnet", minChars: 400 },
  engine: "auto",
  integrations: { claude: false, gemini: false, codex: false, claudeDesktop: false, chatgpt: false },
  remote: { tokenHash: null, excludeSections: ["financial", "personal"], readOnly: false, writesPerHour: 30 },
});

export const paths = (vault: string) => ({
  md: path.join(vault, "taste.md"),
  json: path.join(vault, "taste.json"),
  config: path.join(vault, "config.json"),
  log: path.join(vault, "capture.log"),
  lock: path.join(vault, ".lock"),
  bin: path.join(vault, "bin", "taste-profile.js"),
});

export function resolveVault(): string {
  let v: string;
  try { v = fs.realpathSync(linkPath()); } catch {
    throw new VaultError(`Vault not found at ${linkPath()}. Run: npx taste-profile init`);
  }
  if (!fs.existsSync(paths(v).md)) throw new VaultError(`taste.md not found in ${v}`);
  return v;
}

export function atomicWrite(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readConfig(vault: string): Config {
  const d = defaultConfig(vault);
  let raw: Partial<Config> = {};
  try { raw = JSON.parse(fs.readFileSync(paths(vault).config, "utf8")); } catch {}
  return {
    ...d, ...raw, vault,
    hook: { ...d.hook, ...raw.hook },
    integrations: { ...d.integrations, ...raw.integrations },
    remote: { ...d.remote, ...raw.remote },
  };
}

export const writeConfig = (vault: string, c: Config) => atomicWrite(paths(vault).config, JSON.stringify(c, null, 2) + "\n");

export const loadDoc = (vault: string): Doc => parse(fs.readFileSync(paths(vault).md, "utf8"));

export function saveDoc(vault: string, doc: Doc) {
  const p = paths(vault);
  const md = serialize(doc);
  if (!fs.existsSync(p.md) || fs.readFileSync(p.md, "utf8") !== md) atomicWrite(p.md, md);
  atomicWrite(p.json, JSON.stringify(toJson(doc), null, 2) + "\n");
}

// json only: rewriting taste.md here could revert a user edit that lands mid-call
export const regenJson = (vault: string) =>
  atomicWrite(paths(vault).json, JSON.stringify(toJson(loadDoc(vault)), null, 2) + "\n");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withLock<T>(vault: string, fn: () => T | Promise<T>): Promise<T> {
  const f = paths(vault).lock;
  for (let i = 0; i < 10; i++) {
    try {
      fs.closeSync(fs.openSync(f, "wx"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(f).mtimeMs; } catch { continue; }
      if (age > 60_000) { fs.rmSync(f, { force: true }); continue; }
      await sleep(500);
      continue;
    }
    try { return await fn(); } finally { fs.rmSync(f, { force: true }); }
  }
  throw new VaultError("taste.md is locked by another taste-profile process; try again");
}

export const appendLog = (vault: string, line: string) =>
  fs.appendFileSync(paths(vault).log, `${new Date().toISOString()} ${line}\n`);

export const month = (d = new Date()) => d.toISOString().slice(0, 7);
export const today = (d = new Date()) => d.toISOString().slice(0, 10);
