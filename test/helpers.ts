import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MIN =
  "# T\n\n## Code style\n<!-- hint: code -->\n- Use X (seen 2x, 2026-08..09)\n\n## Personal\n<!-- hint: life -->\n\n## Decision log\n<!-- newest first -->\n- 2026-09-01 [claude] [app] Chose A — fast\n";

export function tmpHome(): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "taste-profile-")));
  process.env.HOME = d;
  return d;
}

/** vault inside a folder with a space, like Google Drive's "My Drive" */
export function makeVault(home: string, md = MIN): string {
  const v = path.join(home, "My Drive", "taste-profile");
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, "taste.md"), md);
  fs.symlinkSync(v, path.join(home, ".taste-profile"));
  return v;
}
