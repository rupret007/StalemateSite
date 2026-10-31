#!/bin/bash
# Values stay in memory/stdin; disable tracing before touching the vault.
set +x
set -euo pipefail
umask 077
mode="${1:---dry-run}"
case "$mode" in --dry-run|--apply) ;; *) printf 'usage: %s [--dry-run|--apply]\n' "$0" >&2; exit 2 ;; esac
[ "$#" -le 1 ] || exit 2
items=('Hangout HMAC Key' 'Hangout Turnstile Secret' 'Hangout TURN Key ID' 'Hangout TURN API Token' 'Hangout TURN Analytics Token')
names=(HANGOUT_HMAC_KEY HANGOUT_TURNSTILE_SECRET HANGOUT_TURN_KEY_ID HANGOUT_TURN_API_TOKEN HANGOUT_TURN_ANALYTICS_TOKEN)
if [ "$mode" = '--dry-run' ]; then
    for i in "${!items[@]}"; do printf '%s -> %s\n' "${items[$i]}" "${names[$i]}"; done
    exit 0
fi
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
getter="$HOME/vaultwarden/bin/bw-get"
[ -x "$getter" ] || { printf 'Vault helper unavailable\n' >&2; exit 1; }
# Fetch and validate ALL values before the first external write. No files/argv/env values.
values=()
for i in "${!items[@]}"; do
    value="$("$getter" "${items[$i]}" 2>/dev/null)" || { printf 'Vault read failed: %s\n' "${items[$i]}" >&2; exit 1; }
    if [ -z "$value" ] || [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
        printf 'Missing or multiline value: %s\n' "${items[$i]}" >&2; exit 1
    fi
    values+=("$value")
done
[ "${#values[0]}" -ge 32 ] || { printf 'HMAC value is too short\n' >&2; exit 1; }
unset value
cd "$repo_dir/hangout-worker"
for i in "${!items[@]}"; do
    # Suppress both tool streams: errors may include request details. Generic status only.
    if ! printf '%s' "${values[$i]}" | npx wrangler secret put "${names[$i]}" --config wrangler.toml >/dev/null 2>&1; then
        unset values
        printf 'Secret upload failed: %s (earlier items may have succeeded)\n' "${names[$i]}" >&2
        exit 1
    fi
    printf 'Updated %s\n' "${names[$i]}"
done
unset values
