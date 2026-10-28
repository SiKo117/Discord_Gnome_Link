#!/usr/bin/env bash
# Helper script to launch the Mock Discord Desktop IPC Server
# Allows testing the GNOME extension without an active/logged-in Discord client.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MOCK_DISCORD_SOCKET_INDEX="${1:-1}"
export MOCK_DISCORD_SOCKET_PATH="${XDG_RUNTIME_DIR:-/tmp}/discord-ipc-${MOCK_DISCORD_SOCKET_INDEX}"

echo "Starting Mock Discord Desktop IPC Server..."
exec node "${DIR}/mock-discord-rpc.mjs"
