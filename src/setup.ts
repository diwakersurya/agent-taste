import fs from "node:fs";
import path from "node:path";
import type { Flags, IO } from "./cli";
import { cloudFolders } from "./detect";
import { IntegrationError, makeCtx } from "./integrations/blocks";
import { INTEGRATIONS, getIntegration } from "./integrations/index";
import { cleanLegacy } from "./integrations/legacy";
import { PRESETS, presetMarkdown } from "./presets";
import {
  appendLog, type Config, defaultConfig, home, linkPath, paths, readConfig, regenJson, resolveVault, VaultError, writeConfig,
} from "./vault";

const yes = (a: string, dflt = true) => (a === "" ? dflt : /^y/i.test(a));

export function installBin(vault: string, self = process.env.AGENT_TASTE_SELF ?? process.argv[1] ?? ""): boolean {
  if (path.basename(self) !== "agent-taste.js") return false; // dev/test runs from source; bundled runs copy themselves
  const dst = paths(vault).bin;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (path.resolve(self) !== path.resolve(dst)) fs.copyFileSync(self, dst);
  fs.chmodSync(dst, 0o755);
  return true;
}

function link(vault: string) {
  const l = linkPath();
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(l); } catch {}
  if (st && !st.isSymbolicLink()) throw new VaultError(`${l} exists and is not a symlink; move it away and re-run init`);
  if (st) {
    let cur = "";
    try { cur = fs.realpathSync(l); } catch {}
    if (cur === fs.realpathSync(vault)) return;
    fs.rmSync(l);
  }
  fs.symlinkSync(vault, l);
}

async function chooseDir(f: Flags, io: IO): Promise<string> {
  if (f.dir) return path.resolve(f.dir);
  const dflt = path.join(home(), "agent-taste");
  if (f.yes) return dflt;
  const opts = [...cloudFolders(home()).map((c) => ({ label: `${c.label} (backed up)`, path: path.join(c.path, "agent-taste") })), { label: "Home folder", path: dflt }];
  io.out("Where should your taste vault live?");
  opts.forEach((o, i) => io.out(`  ${i + 1}) ${o.label}: ${o.path}`));
  const a = await io.ask(`Number or a custom path [1]: `);
  if (!a) return opts[0].path;
  const n = Number(a);
  return Number.isInteger(n) && opts[n - 1] ? opts[n - 1].path : path.resolve(a.replace(/^~(?=\/)/, home()));
}

async function choosePreset(f: Flags, io: IO): Promise<{ title: string; hint: string }[]> {
  let p = f.preset ?? (f.yes ? "developer" : await io.ask("Preset? developer / designer / general / custom [developer]: ")) ?? "";
  p ||= "developer";
  if (p === "custom") {
    const titles = (await io.ask("Section titles, comma separated: ")).split(",").map((t) => t.trim()).filter(Boolean);
    const out = [];
    for (const t of titles) out.push({ title: t, hint: (await io.ask(`Hint for "${t}" (what belongs there): `)) || t });
    return out;
  }
  if (!(p in PRESETS)) throw new VaultError(`Unknown preset "${p}"`);
  return PRESETS[p as keyof typeof PRESETS];
}

export async function cmdInit(f: Flags, io: IO): Promise<number> {
  const vault = await chooseDir(f, io);
  fs.mkdirSync(vault, { recursive: true });
  if (!fs.existsSync(paths(vault).md)) fs.writeFileSync(paths(vault).md, presetMarkdown(await choosePreset(f, io)));
  link(vault);
  const real = fs.realpathSync(vault);
  installBin(real);
  const cfg: Config = fs.existsSync(paths(real).config) ? readConfig(real) : defaultConfig(real);
  const ctx = makeCtx(home());
  for (const file of cleanLegacy(ctx)) io.out(`Removed old hand-made setup from ${file}`);
  for (const it of INTEGRATIONS) {
    if (it.id === "chatgpt" || !it.detect(ctx)) continue;
    cfg.integrations[it.id] = f.yes ? true : yes(await io.ask(`Set up ${it.label}? [Y/n]: `));
  }
  cfg.hook.enabled = f["no-hook"] ? false : f.yes ? cfg.hook.enabled : cfg.integrations.claude ? yes(await io.ask("Auto-capture taste when Claude Code sessions end (uses your Claude plan)? [Y/n]: ")) : cfg.hook.enabled;
  writeConfig(real, cfg);
  for (const it of INTEGRATIONS) {
    if (!cfg.integrations[it.id] || it.id === "chatgpt") continue;
    try { it.install(ctx, cfg); } catch (e) {
      if (!(e instanceof IntegrationError)) throw e;
      io.err(`${it.label}: ${e.message}`);
      cfg.integrations[it.id] = false;
      writeConfig(real, cfg);
    }
  }
  regenJson(real);
  appendLog(real, `init ${JSON.stringify(cfg.integrations)} hook=${cfg.hook.enabled}`);
  io.out(`\nVault: ${real}\nOpen it in Obsidian with "Open folder as vault".\n`);
  return cmdStatus(io);
}

export function cmdStatus(io: IO): number {
  const vault = resolveVault();
  const cfg = readConfig(vault);
  const ctx = makeCtx(home());
  io.out(`Vault      ${vault}`);
  io.out(`Link       ${linkPath()}`);
  io.out(`Hook       ${cfg.hook.enabled ? `on (${cfg.hook.model})` : "off"}`);
  io.out(`Bin        ${fs.existsSync(paths(vault).bin) ? paths(vault).bin : "missing — run: npx agent-taste update"}`);
  for (const it of INTEGRATIONS) {
    const state = it.id === "chatgpt" ? (cfg.remote.tokenHash ? "token set" : "not set up") : it.installed(ctx) ? "installed" : cfg.integrations[it.id] ? "enabled but missing — run update" : "off";
    io.out(`${it.label.padEnd(40)} ${state}`);
  }
  const log = fs.existsSync(paths(vault).log) ? fs.readFileSync(paths(vault).log, "utf8").trimEnd().split("\n").pop() : "";
  io.out(`Last log   ${log || "(none)"}`);
  return 0;
}

export function cmdUpdate(io: IO): number {
  const vault = resolveVault();
  const cfg = readConfig(vault);
  io.out(installBin(vault) ? `Updated ${paths(vault).bin}` : "Not running from a bundled build; bin not copied");
  const ctx = makeCtx(home());
  for (const it of INTEGRATIONS) if (cfg.integrations[it.id] && it.id !== "chatgpt") it.install(ctx, cfg);
  return cmdStatus(io);
}

export async function cmdIntegrate(id: string, f: Flags, io: IO): Promise<number> {
  const vault = resolveVault();
  const cfg = readConfig(vault);
  const it = getIntegration(id);
  const ctx = makeCtx(home());
  if (f.off) it.remove(ctx); else it.install(ctx, cfg);
  cfg.integrations[it.id] = !f.off;
  writeConfig(vault, cfg);
  io.out(`${it.label}: ${f.off ? "removed" : "installed"}`);
  return 0;
}

export async function cmdUninstall(f: Flags, io: IO): Promise<number> {
  const ctx = makeCtx(home());
  let vault: string | null = null;
  try { vault = resolveVault(); } catch {}
  for (const it of INTEGRATIONS) it.remove(ctx);
  fs.rmSync(linkPath(), { force: true });
  io.out("Removed agent-taste from all tool configs.");
  if (f.purge && vault) {
    const ok = f.yes || (await io.ask(`Delete the vault ${vault} and your taste profile permanently? Type "delete": `)) === "delete";
    if (ok) { fs.rmSync(vault, { recursive: true, force: true }); io.out(`Deleted ${vault}`); }
  } else if (vault) io.out(`Your profile is kept at ${vault}`);
  return 0;
}
