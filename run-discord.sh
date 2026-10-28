#!/usr/bin/env bash
# Helper script to launch the installed Flatpak Discord Desktop client
# Works on both containerized/unprivileged and standard environments.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLATPAK_DISCORD_BIN="${HOME}/.local/share/flatpak/app/com.discordapp.Discord/x86_64/stable/active/files/discord/Discord"

# If flatpak command works with bwrap, use flatpak run
if flatpak run com.discordapp.Discord --help &>/dev/null; then
    echo "Launching via Flatpak sandbox..."
    exec flatpak run com.discordapp.Discord "$@"
elif [ -x "${FLATPAK_DISCORD_BIN}" ]; then
    echo "Launching Discord Desktop directly (unprivileged container mode)..."
    exec "${FLATPAK_DISCORD_BIN}" --no-sandbox "$@"
elif command -v discord &>/dev/null; then
    exec discord "$@"
else
    echo "Error: Discord binary not found. Please install Flatpak Discord."
    exit 1
fi
