# taste-profile

One taste profile for all your AI agents. Your preferences and past decisions live in a plain markdown file you own (open it in Obsidian), stored in a folder of your choice — put it in Google Drive / iCloud / Dropbox for backup. Claude Code, Gemini CLI, Codex CLI, Claude Desktop and ChatGPT read it, and it updates itself from your decisions.

```bash
npx taste-profile init
```

## What you get
- `taste.md` — sections like Code style, Tooling, Financial, Personal, plus a dated Decision log. Edit it any time; your edits win.
- `taste.json` — the same content, structured for analysis (regenerated automatically).
- Auto-capture: when a Claude Code session ends, your own messages from it are distilled into the profile by your installed agent CLI (uses your plan; `taste-profile hook off` to disable).

## Commands
```
taste-profile section list | add "<title>" --hint ".." | rename | hint | remove [--archive|--force]
taste-profile add "<preference>" -s "<section>"
taste-profile log "<choice>" --why ".." --folder ..
taste-profile show [section] | search <term>
taste-profile backfill --since 30d [--dry-run]
taste-profile integrate <claude|gemini|codex|claude-desktop|chatgpt> [--off]
taste-profile status | update | uninstall [--purge]
```

## Privacy
- Everything stays in your folder. Nothing is sent anywhere except: at capture time, your own messages from that session go to the agent CLI you already use (Claude / Codex / Gemini).
- A filter drops anything that looks like a key, token, email, account or card number before it is written.
- Financial and Personal sections are preference-only and hidden from remote (ChatGPT) access by default.
- `uninstall` removes exactly what was added to your tool configs.

## Supported
macOS and Linux, Node ≥ 18. Windows is untested.
