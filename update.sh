#!/usr/bin/env bash
set -e

UUID="discord-voice-panel@example.com"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo " Discord Voice Panel GNOME Extension Updater"
echo " Target UUID: ${UUID}"
echo " Source Path: ${SRC_DIR}"
echo "=========================================================="

GIT_PULL=false
FORCE_MODE=""

for arg in "$@"; do
    case "$arg" in
        --link|-l)
            FORCE_MODE="link"
            ;;
        --copy|-c)
            FORCE_MODE="copy"
            ;;
        --git|-g)
            GIT_PULL=true
            ;;
        --help|-h)
            echo "Usage: ./update.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -g, --git     Pull the latest git changes before updating files"
            echo "  -l, --link    Force update using symlink mode"
            echo "  -c, --copy    Force update using directory copy mode"
            echo "  -h, --help    Show this help message"
            exit 0
            ;;
    esac
done

# Step 0: Git pull if requested
if [ "${GIT_PULL}" = true ]; then
    echo "[0/5] Pulling latest git changes..."
    if command -v git &> /dev/null && [ -d "${SRC_DIR}/.git" ]; then
        git -C "${SRC_DIR}" pull || echo "  ! git pull encountered issues; continuing with local files."
    else
        echo "  ! Not a git repository or git command not found. Skipping git pull."
    fi
fi

# Detect current installation mode if not forced
MODE="${FORCE_MODE}"
if [ -z "${MODE}" ]; then
    if [ -L "${TARGET_DIR}" ]; then
        MODE="link"
    else
        MODE="copy"
    fi
fi

# 1. Compile GSettings schemas
echo "[1/5] Compiling GSettings schemas..."
if command -v glib-compile-schemas &> /dev/null; then
    glib-compile-schemas "${SRC_DIR}/schemas"
    echo "  ✓ Schemas compiled in source directory."
else
    echo "  ! glib-compile-schemas not found. Please ensure glib2 is installed."
fi

# 2. Deploy updated files
echo "[2/5] Updating extension files (${MODE} mode)..."
mkdir -p "${HOME}/.local/share/gnome-shell/extensions"

if [ "${MODE}" == "link" ]; then
    ln -sfn "${SRC_DIR}" "${TARGET_DIR}"
    echo "  ✓ Extension symlink verified: ${TARGET_DIR} -> ${SRC_DIR}"
else
    rm -rf "${TARGET_DIR}"
    mkdir -p "${TARGET_DIR}/schemas"
    cp "${SRC_DIR}/metadata.json" "${TARGET_DIR}/"
    cp "${SRC_DIR}/extension.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/indicator.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/avatarUtils.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/avatarManager.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/discordRpc.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/rpcProtocol.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/socketUtils.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/prefs.js" "${TARGET_DIR}/"
    cp "${SRC_DIR}/stylesheet.css" "${TARGET_DIR}/"
    cp "${SRC_DIR}/schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml" "${TARGET_DIR}/schemas/"
    if [ -f "${SRC_DIR}/schemas/gschemas.compiled" ]; then
        cp "${SRC_DIR}/schemas/gschemas.compiled" "${TARGET_DIR}/schemas/"
    elif command -v glib-compile-schemas &> /dev/null; then
        glib-compile-schemas "${TARGET_DIR}/schemas/"
    fi
    echo "  ✓ Extension files copied to: ${TARGET_DIR}"
fi

# Package zip bundle
if command -v python3 &> /dev/null; then
    python3 -c "
import zipfile, os
files = [
    'metadata.json', 'extension.js', 'indicator.js', 'discordRpc.js',
    'rpcProtocol.js', 'socketUtils.js', 'avatarUtils.js', 'avatarManager.js',
    'prefs.js', 'stylesheet.css',
    'schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml',
    'schemas/gschemas.compiled'
]
src = '${SRC_DIR}'
zip_file = os.path.join(src, '${UUID}.shell-extension.zip')
with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        full = os.path.join(src, f)
        if os.path.exists(full):
            zf.write(full, f)
" 2>/dev/null && echo "  ✓ ZIP bundle generated: ${SRC_DIR}/${UUID}.shell-extension.zip" || true
fi

# 3. Verify Flatpak permissions and Vesktop IPC mapping
echo "[3/5] Verifying Flatpak Discord & Vesktop permissions..."
if command -v flatpak &> /dev/null; then
    # Discord official / Canary
    for app in "com.discordapp.Discord" "com.discordapp.DiscordCanary"; do
        if flatpak list | grep -q "${app}"; then
            echo "  Ensuring IPC permissions for ${app}..."
            flatpak override --user --filesystem=xdg-run/discord-ipc-* "${app}" 2>/dev/null || true
            flatpak override --user --filesystem=xdg-run/app/com.discordapp.Discord:create "${app}" 2>/dev/null || true
            echo "  ✓ ${app} overrides verified."
        fi
    done

    # Vesktop
    if flatpak list | grep -q "dev.vencord.Vesktop"; then
        echo "  Detected Flatpak Vesktop. Ensuring IPC permissions..."
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
        echo "  ℹ Vesktop reminder: Ensure 'Enable Rich Presence via arRPC' is ON in Vesktop Settings."
    fi
else
    echo "  ℹ Flatpak CLI not found, skipping Flatpak check."
fi

# 4. Reload GNOME Shell extension
echo "[4/5] Reloading GNOME Shell extension..."
if command -v gnome-extensions &> /dev/null; then
    gnome-extensions disable "${UUID}" 2>/dev/null || true
    sleep 1
    gnome-extensions enable "${UUID}" 2>/dev/null || true
    echo "  ✓ Extension reloaded via gnome-extensions CLI."
else
    echo "  ! gnome-extensions command not found."
fi

# 5. Summary
echo "[5/5] Finalizing update..."
echo "=========================================================="
echo " Update completed successfully!"
echo " NOTE: On Wayland, if GNOME Shell did not pick up code changes,"
echo "       please log out and log back into your desktop session."
echo "=========================================================="
