import fs from "node:fs";
import path from "node:path";

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export function cloudFolders(home: string): { label: string; path: string }[] {
  const found: { label: string; path: string }[] = [];
  const cs = path.join(home, "Library", "CloudStorage");
  for (const name of isDir(cs) ? fs.readdirSync(cs).sort() : []) {
    const base = path.join(cs, name);
    if (name.startsWith("GoogleDrive-") && isDir(path.join(base, "My Drive")))
      found.push({ label: `Google Drive (${name.slice(12)})`, path: path.join(base, "My Drive") });
    else if (name.startsWith("Dropbox")) found.push({ label: "Dropbox", path: base });
    else if (name.startsWith("OneDrive")) found.push({ label: `OneDrive${name.slice(8).replace(/^-/, " ")}`, path: base });
  }
  const icloud = path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
  if (isDir(icloud)) found.push({ label: "iCloud Drive", path: icloud });
  for (const [label, rel] of [["Dropbox", "Dropbox"], ["Google Drive", "Google Drive"]] as const)
    if (isDir(path.join(home, rel)) && !found.some((f) => f.label.startsWith(label))) found.push({ label, path: path.join(home, rel) });
  return found;
}
