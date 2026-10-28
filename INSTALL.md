# Installation & Setup Guide: Discord Voice Panel

This comprehensive guide walks you through installing, configuring, testing, and troubleshooting the **Discord Voice Panel** extension for **GNOME Shell 45 through 51** running on **Wayland** or **X11** (Arch Linux, Fedora, Ubuntu, Debian, openSUSE, Manjaro, Pop!_OS).

---

## Table of Contents
1. [Prerequisites & System Compatibility](#1-prerequisites--system-compatibility)
2. [Method 1: Fast Automated Installation (Recommended)](#2-method-1-fast-automated-installation-recommended)
3. [Method 2: Development / Symlink Mode](#3-method-2-development--symlink-mode)
4. [Method 3: Installation via Make](#4-method-3-installation-via-make)
5. [Method 4: Manual Step-by-Step Installation](#5-method-4-manual-step-by-step-installation)
6. [Discord Socket Configuration (Native, Flatpak, Snap, Vesktop)](#6-discord-socket-configuration-native-flatpak-snap-vesktop)
7. [Wayland Session Reloading & Testing](#7-wayland-session-reloading--testing)
8. [Verifying Logs & Troubleshooting](#8-verifying-logs--troubleshooting)
9. [Updating the Extension](#9-updating-the-extension)
10. [Packaging as a `.zip` Distribution File](#10-packaging-as-a-zip-distribution-file)
11. [Uninstallation & Complete Purge](#11-uninstallation--complete-purge)

---

## 1. Prerequisites & System Compatibility

- **GNOME Shell**: Versions `45`, `46`, `47`, `48`, `49`, `50`, or `51`.
- **Display Server**: Wayland or X11.
- **Discord Client**: Any of the following:
  - **Native Discord** (e.g. `pacman -S discord`, AUR `discord-canary`, `.deb`, `.rpm`)
  - **Flatpak Discord** (`com.discordapp.Discord` or `com.discordapp.DiscordCanary`)
  - **Snap Discord** (`discord`)
  - **Mock Discord Server** (`mock-discord-rpc.mjs` - included for testing without a Discord account)
- **Required Build Tools**:
  - `glib2` (provides `glib-compile-schemas`)
  - `gnome-extensions` command-line utility
  - `make` (optional, for Make-based operations)
  - `node` (v18+, optional for running tests or mock RPC server)

---

## 2. Method 1: Fast Automated Installation (Recommended)

Run the included installer script from the root of the project directory:

```bash
chmod +x install.sh
./install.sh
```

### What `install.sh` does:
1. Validates your GNOME Shell version.
2. Compiles GSettings XML schemas into `gschemas.compiled`.
3. Copies all extension source files into `~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/`.
4. Checks for Flatpak Discord installations and automatically applies filesystem socket overrides if needed.
5. Enables the extension in GNOME Shell.

---

## 3. Method 2: Development / Symlink Mode

If you are modifying, hacking on, or developing features for the extension, you should install using symlink mode. Changes to files in the repository will be reflected immediately in GNOME Shell without re-copying:

```bash
./install.sh --link
# or: make link && make enable
```

To switch back to standard copy mode later, simply run `./install.sh` without the `--link` flag.

---

## 4. Method 3: Installation via Make

If you prefer using `make`:

```bash
# Build schemas and install extension files
make install

# Enable the extension in GNOME Shell
make enable
```

---

## 5. Method 4: Manual Step-by-Step Installation

If you prefer to perform every step manually without helper scripts:

### Step 1: Create the Extension Target Directory
```bash
mkdir -p ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas
```

### Step 2: Copy Extension Files
```bash
cp metadata.json extension.js indicator.js discordRpc.js rpcProtocol.js \
   socketUtils.js avatarUtils.js avatarManager.js prefs.js stylesheet.css \
   ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/

cp schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml \
   ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas/
```

### Step 3: Compile GSettings Schemas
```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas/
```

### Step 4: Enable Extension
```bash
gnome-extensions enable discord-voice-panel@example.com
```

---

## 6. Discord Socket Configuration (Native, Flatpak, Snap, Vesktop)

Discord communicates with local applications via Unix domain socket files (`discord-ipc-0` through `discord-ipc-9`). Depending on how Discord is packaged on your system, the socket location and sandboxing permissions vary:

### 6.1 Native Discord (`pacman`, `deb`, `rpm`)
No extra configuration is required. Discord creates the socket under `$XDG_RUNTIME_DIR/discord-ipc-0` (typically `/run/user/1000/discord-ipc-0`).

Verify that your socket exists:
```bash
ls -la "$XDG_RUNTIME_DIR"/discord-ipc-*
```

### 6.2 Official Flatpak Discord (`com.discordapp.Discord`)
Flatpak applications are sandboxed by default and cannot share their runtime sockets with host processes unless granted permission. Grant filesystem socket access by running:

```bash
flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord
```

For Discord Canary Flatpak:
```bash
flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.DiscordCanary
```

> **Important**: Fully quit and restart your Flatpak Discord client after running this command.

### 6.3 Vesktop Flatpak (`dev.vencord.Vesktop`)
Vesktop runs inside its Flatpak sandbox and provides Discord IPC via its built-in arRPC server.
1. Grant Flatpak filesystem permissions:
   ```bash
   flatpak override --user --filesystem=xdg-run/discord-ipc-* dev.vencord.Vesktop
   flatpak override --user --filesystem=xdg-run/app/com.discordapp.Discord:create dev.vencord.Vesktop
   ```
2. Enable persistent user-tmpfiles socket mapping:
   ```bash
   mkdir -p ~/.config/user-tmpfiles.d
   echo 'L %t/discord-ipc-0 - - - - .flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0' > ~/.config/user-tmpfiles.d/discord-rpc.conf
   systemctl --user enable --now systemd-tmpfiles-setup.service
   ```
3. In Vesktop: Go to **Settings** -> **Vesktop Settings** -> ensure **"Enable Rich Presence via arRPC"** is ON.
> *Note: arRPC only supports game presence, not voice status.*

---

## 7. Wayland Session Reloading & Testing

Under Wayland, the GNOME Shell compositor cannot be restarted in-place with `Alt + F2` -> `r` (which only works under legacy X11). Use one of the following methods to reload:

### Method A: Quick Re-toggle in Extensions App (Fastest)
1. Open the **Extensions** app (`gnome-extensions-app`).
2. Toggle **Discord Voice Panel** OFF and back ON.

### Method B: Log Out and Log Back In
The cleanest and recommended way for a new installation on a production Wayland desktop:
1. Save your open work.
2. Log out of your GNOME session and log back in.
3. Enable via:
   ```bash
   gnome-extensions enable discord-voice-panel@example.com
   ```

### Method C: Nested Wayland Session (Recommended for Testing/Development)
Run a nested GNOME Shell instance inside a window without affecting your main desktop:

```bash
# GNOME 45 - 48:
dbus-run-session gnome-shell --nested --wayland

# GNOME 49 - 51:
dbus-run-session gnome-shell --devkit --wayland
```

Inside the nested window, open a terminal and test the extension safely.

---

## 8. Verifying Logs & Troubleshooting

To monitor live extension logs, socket events, and connection status:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i DiscordVoice
```

### Expected Startup Log:
```text
[DiscordVoice] Connected to Discord IPC as YourUsername
[DiscordVoice] Active voice channel: General Voice (3 participants)
```

### Common Issues:
- **"Socket file not found"**: Ensure Discord Desktop is running, run `ls -la $XDG_RUNTIME_DIR/discord-ipc-*`, and update the path in Extension Settings if on `discord-ipc-1`.
- **"User logged out"**: Discord is running but no user is signed in. Sign in to Discord Desktop with your account.
- **Flatpak doesn't show in socket list**: Apply the Flatpak override shown in Section 6.2 and restart Discord.

---

## 9. Updating the Extension

To update an existing installation to the latest version:

```bash
chmod +x update.sh
./update.sh
```

Or using `make`:
```bash
make update
```

The update script automatically:
- Preserves your existing installation mode (symlink vs copy).
- Re-compiles GSettings schemas.
- Deploys updated extension files.
- Verifies Flatpak Discord & Vesktop socket permissions.
- Reloads the extension in GNOME Shell.

---

## 10. Packaging as a `.zip` Distribution File

To bundle the extension into a distributable archive ready for installation or uploading to [extensions.gnome.org](https://extensions.gnome.org/):

```bash
make pack
```

This compiles GSettings schemas and produces `discord-voice-panel@example.com.shell-extension.zip`. You can install it on any machine using:

```bash
gnome-extensions install --force discord-voice-panel@example.com.shell-extension.zip
```

---

## 11. Uninstallation & Complete Purge

### Option 1: Clean Uninstallation (Preserves Settings)
Removes installed extension files and reverts Flatpak socket overrides:

```bash
./uninstall.sh
# or: make uninstall
```

### Option 2: Complete Purge (Removes Files & Wipes Settings/Tokens)
Removes extension files, reverts Flatpak overrides, and resets all saved user preferences and OAuth tokens from `dconf`:

```bash
./uninstall.sh --purge
# or: make purge
```

### Option 3: Manual Removal
```bash
gnome-extensions disable discord-voice-panel@example.com
rm -rf ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com
dconf reset -f /org/gnome/shell/extensions/discord-voice-panel/
flatpak override --user --nofilesystem=xdg-run/discord-ipc-* com.discordapp.Discord
```
