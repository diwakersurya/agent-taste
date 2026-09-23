# Security

## Remote MCP (ChatGPT)

`agent-taste mcp --http` is the only network-facing part.

- Listens on `127.0.0.1` only (not configurable). Reaching it from outside requires the user to run OpenAI's outbound-only Secure MCP Tunnel.
- Requires a 256-bit random token (`agent-taste integrate chatgpt` or `mcp --rotate-token`). Only its SHA-256 is stored. Accepted as `Authorization: Bearer <token>` or in the path `/mcp/<token>`; compared in constant time.
- Requests with an unexpected `Origin` header are rejected (DNS-rebinding protection). Bodies over 64 KB are rejected.
- `financial` and `personal` sections are hidden from remote reads and writes by default (`remote.excludeSections`).
- Tools are read + append-only: no delete or rewrite. Remote writes are limited to 30/hour and logged to `capture.log`. `--read-only` / `remote.readOnly` disables writes.

## Capture

- Ops from the model are validated and passed through a secret / personal-identifier filter before anything is written.
- The hook never blocks or fails Claude Code; errors go to `capture.log`.

## Reporting

Please open a private security advisory on the GitHub repository.
