#!/bin/sh
cat > "${FAKE_PROMPT:-/dev/null}"
if [ -n "$FAKE_SLEEP" ]; then sleep "$FAKE_SLEEP"; fi
if [ -n "$FAKE_FAIL" ]; then echo "boom" >&2; exit 3; fi
cat "$FAKE_OUT"
