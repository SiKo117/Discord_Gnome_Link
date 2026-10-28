# Discord Voice Panel (GNOME Shell Extension)

[![GNOME Shell 45–51](https://img.shields.io/badge/GNOME-45%20..%2051-blue?logo=gnome)](https://gjs.guide)
[![Wayland Native](https://img.shields.io/badge/Wayland-Native-success)](https://wayland.freedesktop.org/)
[![Discord IPC RPC](https://img.shields.io/badge/Discord-IPC%20RPC-5865F2?logo=discord)](https://discord.com/developers/docs/topics/rpc)
[![CI Tests](https://img.shields.io/badge/CI-Passing-brightgreen.svg)](tests/)

A high-performance, Wayland-native GNOME Shell extension for **GNOME 45 through 51** that seamlessly integrates Discord voice calls into your desktop top bar. View voice channel participants, live speaking halos, adjust individual member volumes, hop voice channels, and toggle mute/deafen with zero lag.

---

## ⚠️ Important Disclaimer & Project Notice

> [!IMPORTANT]
> **PLEASE READ BEFORE USING OR INSTALLING:**
>
> 1. **AI-Generated Project**: This project was developed and crafted using Artificial Intelligence (AI) assistance.
> 2. **Personal Use Only & AS-IS**: This software is provided strictly for personal use on an **"AS-IS"** basis, without warranty of any kind, either expressed or implied.
> 3. **No Liability**: The creator/author of this project assumes **no liability or responsibility** for any bugs, system crashes, loss of data, Discord account actions, or any other issues arising from the use or installation of this software.
> 4. **No Maintenance Expected**: Do not expect active maintenance, official customer support, feature roadmaps, or bug fix commitments from the creator.
> 5. **Open to Forking & Community Use**: In the true spirit of open-source software, **anyone is completely free to fork, modify, improve, distribute, or maintain this repository without restriction**, subject only to the terms of the [GNU General Public License v3.0 (GPLv3)](LICENSE).

---

## 🌟 Key Features

### 🎧 Desktop Voice Integration

- **Top Panel Voice Indicator**: Live Discord status, current voice room info, active participant avatars, and counter badge right in the GNOME status area.
- **🟢 Real-Time Speaking Glow Halo**: Dynamic glowing green halo around speaking members' avatars both in the taskbar and the popup menu, powered by native Discord `SPEAKING_START` and `SPEAKING_STOP` IPC events.
- **👥 Active Participant Avatars**: Real-time circular avatar rendering with automatic Discord CDN resolution, animated GIF detection, disk caching, and overflow badge (`+N`).
- **🎚️ Per-Participant Volume Sliders**: Adjust individual user volume from **0% to 200%** or toggle per-user mute directly from the popup menu (`SET_USER_VOICE_SETTINGS`).
- **🔀 Quick Voice Channel Hopping**: Browse and hop between voice rooms in your active server with one click without opening the Discord client.
- **🎤 Two-Way Synchronized Mute & Deafen**: Instant toggles with bidirectional hardware and Discord client synchronization (anti-loop protected).
- **🚪 1-Click Leave Channel**: Quickly disconnect from voice calls without switching workspaces or un-minimizing fullscreen games.

### 🎨 Customization & Appearance

- **3 Dynamic Display Modes**:
  - `Full Avatars`: Shows circular avatar icons for active participants with speaking halos.
  - `Minimalist Status Pill`: Sleek, compact badge displaying call status and count.
  - `Dynamic Speaking-Only`: Hides quiet members from the panel and dynamically surfaces only who is actively speaking.
- **👻 Stealth Mode**: Automatically conceals the extension from the top bar completely when you are not in an active voice room.
- **🖱️ Customizable Quick Mouse Actions**:
  - **Middle-Click**: Instant toggle mute (default), toggle deafen, leave channel, or cycle display mode.
  - **Right-Click**: Leave channel (default), toggle menu, toggle mute, or cycle display mode.
  - **Scroll Wheel**: Cycle display modes (default), adjust volume, or toggle mute.
- **Top Bar Re-ordering & Positioning**: Place the panel in the **Right**, **Center**, or **Left** section, with customizable position index.
- **Custom Glow Color**: Configurable hex color for speaking halos (default Discord green `#23a55a`).

### ⚡ Wayland-Native & Non-Blocking Architecture

- **Zero Shell Stutter**: All Unix domain socket operations use non-blocking `Gio.SocketClient` (`connect_async`, `read_bytes_async`, `write_bytes_async`). Never drops frames in games or freezes the GNOME compositor.
- **🔑 1-Click StreamKit OAuth2 Authorization**: Native Discord authorization dialog (`AUTHORIZE` / `AUTHENTICATE`). No manual API bot creation required.
- **🔌 Manual Socket Targeting**: Connect directly to your configured Discord socket path (`$XDG_RUNTIME_DIR/discord-ipc-0` through `9`) with zero unwanted background polling.
- **⚙️ Modern Libadwaita Settings**: Clean, beautiful preferences dialog matching GNOME design guidelines.

---

## 🖥️ System Requirements & Compatibility

| Component               | Supported Versions                                                                                                                           |
|:----------------------- |:-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop Environment** | GNOME Shell 45, 46, 47, 48, 49, 50, and 51                                                                                                   |
| **Display Server**      | Wayland (native) and X11                                                                                                                     |
| **Linux Distributions** | Arch Linux, Fedora, Ubuntu, Debian, openSUSE, Pop!_OS, Manjaro                                                                               |
| **Discord Clients**     | Official Native Discord (`pacman`, `deb`, `rpm`), Official Flatpak (`com.discordapp.Discord`), Snap (`discord`), and Mock Discord RPC server |

> [!NOTE]
> **A Note on Vesktop / arRPC**: `arRPC` is designed only for Rich Presence (games). It does not implement Discord Voice RPC (`GET_SELECTED_VOICE_CHANNEL` or mute controls). For voice integration, use the Official Discord Desktop client or our included Mock RPC server.

---

## 🚀 Quick Start & Installation

### Option 1: Fast Automated Installer (Recommended)

Clone the repository and run the installation script:

```bash
git clone https://github.com/YOUR_USERNAME/discord-voice-panel.git
cd discord-voice-panel
chmod +x install.sh
./install.sh
```

The script will compile GSettings schemas, install the files to `~/.local/share/gnome-shell/extensions/`, configure Flatpak permissions if needed, and prompt you to enable the extension.

### Option 2: Development / Symlink Mode

If you plan to modify or test code changes:

```bash
./install.sh --link
# or: make link && make enable
```

### Option 3: Using Make

```bash
make install
make enable
```

### Option 4: Manual Step-by-Step Installation

```bash
# 1. Create target directory
mkdir -p ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas

# 2. Copy extension files
cp metadata.json extension.js indicator.js discordRpc.js rpcProtocol.js socketUtils.js avatarUtils.js avatarManager.js prefs.js stylesheet.css \
   ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/

cp schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml \
   ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas/

# 3. Compile schemas
glib-compile-schemas ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com/schemas/

# 4. Enable extension
gnome-extensions enable discord-voice-panel@example.com
```

> [!TIP]
> Under **Wayland**, GNOME Shell cannot be restarted in-place with `Alt+F2` -> `r`. Log out and log back in, or toggle the extension off and on in the **Extensions** app (`gnome-extensions-app`).

For detailed installation steps and Flatpak socket configuration, see [INSTALL.md](INSTALL.md).

---

## 🔌 Connecting to Discord (First-Time Setup)

1. Launch your Discord Desktop client.
2. Join any voice channel in Discord.
3. In your GNOME top bar, click the headset icon or button.
4. Click **🔌 Connect to Discord**.
5. When prompted, click **🔑 Authorize Voice Access (1-Click)**.
6. A native authorization prompt will appear in your Discord client: **"Authorize Discord StreamKit to access your Discord account"**. Click **Authorize**.
7. The extension will instantly connect, save your local session token, and display your channel name, participants, volume sliders, and speaking halos!

> [!TIP]
> If you are using Flatpak Discord, grant socket permissions once:
>
> ```bash
> flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord
> ```
>
> For troubleshooting socket paths, see our dedicated [Manual Connection Guide](MANUAL_CONNECTION_GUIDE.md).

---

## 🔄 Updating the Extension

To pull updates or re-deploy the latest version:

```bash
./update.sh
# or: make update
```

The update script automatically preserves your install mode (symlink vs copy), recompiles GSettings schemas, and reloads the extension cleanly.

---

## 🧪 Testing & Mock Environment

The repository includes a comprehensive standalone Node.js test suite and a simulated Discord IPC daemon:

### 1. Run Unit Tests

```bash
make test
# or: npm test
```

Validates binary frame slicing, packet coalescing, OAuth2 authorization handshakes, avatar hashing, speaking state tracking, and UI lifecycle isolation.

### 2. Test Without a Discord Account (Mock Daemon)

```bash
# Terminal 1: Launch mock server
./run-mock-discord.sh
# (or: npm run mock)
```

In GNOME top bar menu -> **Extension Settings** -> set **Socket Path** to `/tmp/discord-ipc-1` -> click **Connect**. You can interact with simulated voice members (`Fake Account Tester`, `Alice`, `Bob`) with working mute/deafen controls!

---

## 📦 Packaging for Distribution

To bundle the extension into a standard GNOME Shell distribution archive:

```bash
make pack
```

This compiles GSettings schemas and produces `discord-voice-panel@example.com.shell-extension.zip`. You can install it on any machine using:

```bash
gnome-extensions install --force discord-voice-panel@example.com.shell-extension.zip
```

To share this extension on **extensions.gnome.org (EGO)**, Reddit, or the Arch User Repository (AUR), check our comprehensive [Community Sharing Guide](COMMUNITY_SHARING_GUIDE.md).

---

## 🗑️ Uninstallation

To remove the extension:

```bash
./uninstall.sh
```

To remove the extension and completely purge all saved preferences and tokens:

```bash
./uninstall.sh --purge
# or: make purge
```

---

## 📚 Documentation Reference

- 📖 [User Guide & Feature Walkthrough](USER_GUIDE.md): In-depth guide to display modes, mouse shortcuts, volume sliders, and FAQs.
- 🛠️ [Installation Guide](INSTALL.md): Comprehensive setup for Wayland, X11, Flatpak overrides, and systemd socket bridges.
- 🔌 [Manual Connection Guide](MANUAL_CONNECTION_GUIDE.md): Deep-dive into Discord IPC sockets across Native, Flatpak, and Snap.
- 🌐 [Community Sharing Guide](COMMUNITY_SHARING_GUIDE.md): Complete guide to publishing on extensions.gnome.org, GitHub releases, AUR, and Reddit.
- 🤝 [Contributing Guidelines](CONTRIBUTING.md): Code style, testing guidelines, and fork instructions.

---
