#!/usr/bin/env bash
set -e

UUID="discord-voice-panel@example.com"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo " Discord Voice Panel GNOME Extension Installer"
echo " Target UUID: ${UUID}"
echo "=========================================================="

MODE="copy"
if [ "$1" == "--link" ] || [ "$1" == "-l" ]; then
    MODE="link"
fi

# 1. Compile GSettings schemas
echo "[1/4] Compiling GSettings schemas..."
if command -v glib-compile-schemas &> /dev/null; then
    glib-compile-schemas "${SRC_DIR}/schemas"
    echo "  ✓ Schemas compiled successfully."
else
    echo "  ! glib-compile-schemas not found. Please install glib2."
fi

# 2. Deploy files
echo "[2/4] Deploying extension files (${MODE} mode)..."
mkdir -p "${HOME}/.local/share/gnome-shell/extensions"

if [ "${MODE}" == "link" ]; then
    ln -sfn "${SRC_DIR}" "${TARGET_DIR}"
    echo "  ✓ Symlinked: ${TARGET_DIR} -> ${SRC_DIR}"
else
    rm -rf "${TARGET_DIR}"
    mkdir -p "${TARGET_DIR}/schemas"
    cp "${SRC_DIR}/metadata.json" "${TARGET_DIR}/"
    cp "${SRC_DIR}/extension.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/indicator.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/discordRpc.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/rpcProtocol.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/socketUtils.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/avatarUtils.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/avatarManager.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/prefs.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/stylesheet.css" "${TARGET_DIR}/"
    cp "${SRC_DIR}/schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml" "${TARGET_DIR}/schemas/"
    if [ -f "${SRC_DIR}/schemas/gschemas.compiled" ]; then
        cp "${SRC_DIR}/schemas/gschemas.compiled" "${TARGET_DIR}/schemas/"
    elif command -v glib-compile-schemas &> /dev/null; then
        glib-compile-schemas "${TARGET_DIR}/schemas/"
    fi
    echo "  ✓ Files copied to ${TARGET_DIR}"
fi

# 3. Check Flatpak socket permission if Discord or Vesktop is Flatpak
echo "[3/4] Checking Flatpak Discord & Vesktop permissions..."
if command -v flatpak &> /dev/null; then
    for app in "com.discordapp.Discord" "com.discordapp.DiscordCanary"; do
        if flatpak list | grep -q "${app}"; then
            echo "  Ensuring IPC permissions for ${app}..."
            flatpak override --user --filesystem=xdg-run/discord-ipc-* "${app}" 2>/dev/null || true
            flatpak override --user --filesystem=xdg-run/app/com.discordapp.Discord:create "${app}" 2>/dev/null || true
            echo "  ✓ ${app} overrides verified."
        fi
    done

    if flatpak list | grep -q "dev.vencord.Vesktop"; then
        echo "  Detected Flatpak Vesktop. Ensuring IPC socket access..."
        flatpak override --user --filesystem=xdg-run/discord-ipc-* dev.vencord.Vesktop 2>/dev/null || true
        flatpak override --user --filesystem=xdg-run/app/com.discordapp.Discord:create dev.vencord.Vesktop 2>/dev/null || true

        mkdir -p "${HOME}/.config/user-tmpfiles.d"
        cat << 'EOF' > "${HOME}/.config/user-tmpfiles.d/discord-rpc.conf"
# Vesktop Discord RPC socket mapping
L %t/discord-ipc-0 - - - - .flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0
EOF
        if command -v systemctl &> /dev/null; then
            systemctl --user enable --now systemd-tmpfiles-setup.service 2>/dev/null || true
        fi
        echo "  ✓ Vesktop overrides and user-tmpfiles socket mapping configured."
        echo "  ℹ Tip for Vesktop: In Vesktop Settings -> ensure 'Enable Rich Presence via arRPC' is ON."
    fi
fi

# 4. Enable extension
echo "[4/4] Enabling extension..."
if command -v gnome-extensions &> /dev/null; then
    gnome-extensions enable "${UUID}" 2>/dev/null || true
    echo "  ✓ Extension enabled via gnome-extensions CLI."
    echo ""
    echo "NOTE: On Wayland, restart your session (log out and log back in)"
    echo "      or restart GNOME Shell to reload new extensions."
else
    echo "  ! gnome-extensions command not found on this machine."
    echo "    Run 'gnome-extensions enable ${UUID}' on your target GNOME system."
fi

echo "=========================================================="
echo " Installation finished successfully!"
echo "=========================================================="
