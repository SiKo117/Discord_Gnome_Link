#!/usr/bin/env bash
set -e

UUID="discord-voice-panel@example.com"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SCHEMA_PATH="/org/gnome/shell/extensions/discord-voice-panel/"
SCHEMA_ID="org.gnome.shell.extensions.discord-voice-panel"

echo "=========================================================="
echo " Discord Voice Panel GNOME Extension Uninstaller"
echo " Target UUID: ${UUID}"
echo "=========================================================="

PURGE=false
if [ "$1" == "--purge" ] || [ "$1" == "-p" ]; then
    PURGE=true
fi

# 1. Disable the extension
echo "[1/4] Disabling extension..."
if command -v gnome-extensions &> /dev/null; then
    gnome-extensions disable "${UUID}" 2>/dev/null || true
    echo "  ✓ Extension disabled."
else
    echo "  ! gnome-extensions command not found, skipping disable step."
fi

# 2. Remove extension files / symlink
echo "[2/4] Removing extension files..."
if [ -L "${TARGET_DIR}" ]; then
    rm "${TARGET_DIR}"
    echo "  ✓ Removed extension symlink from: ${TARGET_DIR}"
elif [ -d "${TARGET_DIR}" ]; then
    rm -rf "${TARGET_DIR}"
    echo "  ✓ Removed extension directory: ${TARGET_DIR}"
else
    echo "  ℹ Extension directory does not exist: ${TARGET_DIR}"
fi

# 3. Purge GSettings / dconf configuration if requested
echo "[3/4] Handling configuration settings..."
if [ "${PURGE}" = true ]; then
    if command -v dconf &> /dev/null; then
        dconf reset -f "${SCHEMA_PATH}" 2>/dev/null || true
        echo "  ✓ Purged dconf settings for: ${SCHEMA_PATH}"
    elif command -v gsettings &> /dev/null; then
        gsettings reset-recursively "${SCHEMA_ID}" 2>/dev/null || true
        echo "  ✓ Reset gsettings keys for: ${SCHEMA_ID}"
    else
        echo "  ! Neither dconf nor gsettings CLI found to purge settings."
    fi

    if [ -f "${HOME}/.config/user-tmpfiles.d/discord-rpc.conf" ]; then
        rm -f "${HOME}/.config/user-tmpfiles.d/discord-rpc.conf"
        echo "  ✓ Removed user-tmpfiles discord-rpc mapping."
    fi

    if [ -d "${HOME}/.cache/discord-voice-panel" ]; then
        rm -rf "${HOME}/.cache/discord-voice-panel"
        echo "  ✓ Removed avatar cache from: ${HOME}/.cache/discord-voice-panel"
    fi
else
    echo "  ℹ Preserved user settings (use './uninstall.sh --purge' to wipe configuration)."
fi

# 4. Clean up Flatpak Discord & Vesktop socket overrides
echo "[4/4] Checking Flatpak Discord & Vesktop overrides..."
FLATPAK_APPS=("com.discordapp.Discord" "com.discordapp.DiscordCanary" "dev.vencord.Vesktop" "de.shorsh.discord-screenaudio")
FLATPAK_OVERRIDE_FOUND=false

for app in "${FLATPAK_APPS[@]}"; do
    OVERRIDE_FILE="${HOME}/.local/share/flatpak/overrides/${app}"
    if [ -f "${OVERRIDE_FILE}" ] && grep -q "discord-ipc" "${OVERRIDE_FILE}"; then
        FLATPAK_OVERRIDE_FOUND=true
        echo "  Found IPC socket override for ${app}."

        if command -v flatpak &> /dev/null; then
            flatpak override --user --nofilesystem=xdg-run/discord-ipc-* "${app}" 2>/dev/null || true
        fi

        # Remove the specific discord-ipc entry from the override file
        sed -i 's/xdg-run\/discord-ipc-\*;//g' "${OVERRIDE_FILE}" 2>/dev/null || true
        sed -i 's/xdg-run\/discord-ipc-\*//g' "${OVERRIDE_FILE}" 2>/dev/null || true
        sed -i '/^filesystems=[;[:space:]]*$/d' "${OVERRIDE_FILE}" 2>/dev/null || true

        # Clean up empty files or sections if no other custom permissions exist
        if [ ! -s "${OVERRIDE_FILE}" ] || [ "$(grep -Ev '^(\[Context\]|[[:space:]]*$)' "${OVERRIDE_FILE}" 2>/dev/null | wc -l)" -eq 0 ]; then
            rm -f "${OVERRIDE_FILE}"
            echo "  ✓ Cleaned up and removed empty override file: ${OVERRIDE_FILE}"
        else
            echo "  ✓ Removed discord-ipc permission while preserving your other ${app} overrides."
        fi
    fi
done

if [ "${FLATPAK_OVERRIDE_FOUND}" = false ]; then
    echo "  ℹ No Flatpak Discord overrides needed cleanup."
fi

echo ""
echo "=========================================================="
echo " Uninstallation completed successfully!"
echo " Note: On Wayland, log out and back in to fully unload"
echo "       the extension from GNOME Shell's memory."
echo "=========================================================="
