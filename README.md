# agent-taste

One taste profile for all your AI agents. Your preferences and past decisions live in a plain markdown file you own (open it in Obsidian), stored in a folder of your choice — put it in Google Drive / iCloud / Dropbox for backup. Claude Code, Gemini CLI, Codex CLI, Claude Desktop and ChatGPT read it, and it updates itself from your decisions.

```bash
npx agent-taste init
```

## What you get
- `taste.md` — sections like Code style, Tooling, Financial, Personal, plus a dated Decision log. Edit it any time; your edits win.
- `taste.json` — the same content, structured for analysis (regenerated automatically).
- Auto-capture: when a Claude Code session ends, your own messages from it are distilled into the profile by your installed agent CLI (uses your plan; `agent-taste hook off` to disable).

## Commands
```
agent-taste section list | add "<title>" --hint ".." | rename | hint | remove [--archive|--force]
agent-taste add "<preference>" -s "<section>"
agent-taste log "<choice>" --why ".." --folder ..
agent-taste show [section] | search <term>
agent-taste backfill --since 30d [--dry-run]
agent-taste integrate <claude|gemini|codex|claude-desktop|chatgpt> [--off]
agent-taste status | update | uninstall [--purge]
```

## Privacy
- Everything stays in your folder. Nothing is sent anywhere except: at capture time, your own messages from that session go to the agent CLI you already use (Claude / Codex / Gemini).
- A filter drops anything that looks like a key, token, email, account or card number before it is written.
- Financial and Personal sections are preference-only and hidden from remote (ChatGPT) access by default.
- `uninstall` removes exactly what was added to your tool configs.

## Supported
macOS and Linux, Node ≥ 18. Windows is untested.
