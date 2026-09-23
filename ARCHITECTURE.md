# Architecture

## Components

| File | Role |
|---|---|
| `src/doc.ts` | Lossless `taste.md` model: `serialize(parse(md)) === md`. Every edit (sections, preferences, decisions) goes through here. |
| `src/json.ts` | Derives `taste.json` from the parsed doc. |
| `src/vault.ts` | Vault location (`~/.taste-profile` symlink), `config.json`, atomic writes, file lock, log. |
| `src/filter.ts` | Detects secrets / personal identifiers (API keys, tokens, emails, account and card numbers). |
| `src/ops.ts` | The op contract (`add`, `bump`, `replace`, `log`): validation, per-run caps, applying ops to the doc. |
| `src/extract.ts` | Pulls only the user's own messages from Claude Code, Codex and Gemini transcripts. |
| `src/capture.ts` | Builds the prompt, runs the installed agent CLI, parses its ops, applies them under the lock. |
| `src/backfill.ts` | Runs capture over past transcripts. |
| `src/integrations/*` | One module per tool: install/remove via marked blocks (markdown) or keyed entries (JSON). |
| `src/mcp.ts` | MCP server: stdio for Claude Desktop, token-guarded localhost HTTP for ChatGPT. |
| `src/setup.ts`, `src/cli.ts` | Commands. |

## Data flow

1. `init` creates the vault, links `~/.taste-profile`, copies the CLI bundle to `<vault>/bin/`, and adds marked blocks / entries to each chosen tool's config.
2. Tools read the profile: Claude Code and Gemini import it, Codex is told to read it, Claude Desktop and ChatGPT call `read_taste`.
3. When a Claude Code session ends, the `SessionEnd` hook runs `capture --stdin`, which regenerates `taste.json`, starts a detached capture process and exits right away.
4. Capture extracts the user's messages, asks the first available agent CLI (`claude`, `codex`, `gemini`) for `{"ops":[...]}`, validates and scrubs the ops, takes the lock, re-reads `taste.md`, applies what still matches, and writes `taste.md` + `taste.json` atomically.
5. MCP writes (`record_preference`, `record_decision`) go through the same validation and lock.

## What is stored where

- Vault: `taste.md` (source of truth), `taste.json` (generated), `config.json` (settings; the remote token only as a SHA-256 hash), `capture.log`, `bin/taste-profile.js`.
- Tool configs: content between `<!-- taste-profile:start -->` / `<!-- taste-profile:end -->`, a `SessionEnd` entry whose command contains `taste-profile.js`, and an `mcpServers["taste-profile"]` entry. The first time a user file is changed it is copied to `<file>.bak-taste-profile`.

## What is sent where

- At capture time, the user's own messages from that session plus the current profile go to the agent CLI the user already has installed; that CLI talks to its own provider as usual.
- Nothing else leaves the machine unless the user sets up the ChatGPT tunnel themselves.

## Why ops instead of letting the model edit the file

The model never touches `taste.md`. It returns a small list of ops that are checked (known section / entry, length, secret filter, caps) and applied by `doc.ts`. That works the same for every engine, needs no file-write permission for the model, and a bad reply cannot corrupt the profile.
