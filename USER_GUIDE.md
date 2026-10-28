# User Guide: Discord Voice Panel

The **Discord Voice Panel** is a Wayland-native GNOME Shell extension that integrates your Discord voice channels directly into your GNOME desktop top bar.

---

## Table of Contents
1. [Top Panel Indicator & Display Modes](#1-top-panel-indicator--display-modes)
2. [Speaking Glow Halo & Real-Time Feedback](#2-speaking-glow-halo--real-time-feedback)
3. [Popup Menu & Voice Controls](#3-popup-menu--voice-controls)
4. [Per-Participant Volume Sliders & User Mute](#4-per-participant-volume-sliders--user-mute)
5. [Quick Voice Channel Hopping](#5-quick-voice-channel-hopping)
6. [Quick Mouse Actions & Gestures](#6-quick-mouse-actions--gestures)
7. [Stealth Mode (Auto-Hide)](#7-stealth-mode-auto-hide)
8. [Configuration & Preferences Reference](#8-configuration--preferences-reference)
9. [Frequently Asked Questions (FAQ) & Troubleshooting](#9-frequently-asked-questions-faq--troubleshooting)

---

## 1. Top Panel Indicator & Display Modes

The indicator resides in the GNOME status area (top bar) and provides immediate, at-a-glance awareness of your voice connection.

### 1.1 Panel Display Modes
You can select between three distinct rendering modes in **Extension Settings** (or switch dynamically by scrolling your mouse wheel over the indicator):

| Mode | Visual Representation | Best Used For |
| :--- | :--- | :--- |
| **Full Avatars (Default)** | Circular avatars of active voice participants with speaking glow halos and overflow badge (`+N`). | Multi-user calls, gaming sessions, and teams where knowing who is in the channel matters. |
| **Minimalist Status Pill** | Compact, pill-shaped badge displaying headset icon, mute state, and participant count. | Clean, distraction-free setups and small laptop displays. |
| **Dynamic Speaking-Only** | Only displays avatars for members who are **actively speaking right now**; completely disappears when everyone is quiet. | High-focus work sessions where you only want visual cues during active conversation. |

### 1.2 Indicator States & Badges

| Indicator State | Visual Appearance | Meaning |
| :--- | :--- | :--- |
| **Disconnected** | `🎧` (Dimmed) | Discord is not running, or socket is waiting for you to click **Connect**. (Hidden if Stealth Mode is ON). |
| **Idle / Online** | `🎧` (Normal brightness) | Connected to Discord, but you are not currently in any voice channel. |
| **Active Call** | `🎧 3` or `[Avatar][Avatar] +1` | Connected to voice room with 3 participants. |
| **Microphone Muted** | `🎤` (Red Accent / Muted) | Your microphone is muted in Discord. |
| **Audio Deafened** | `🔇` (Red Accent / Deafened) | Both your speakers and microphone are deafened. |
| **Speaking Halo** | Bright glowing green halo (`#23a55a`) | You or another channel participant is actively speaking. |

---

## 2. Speaking Glow Halo & Real-Time Feedback

Whenever any participant (or yourself) speaks into their microphone, the extension captures Discord's native `SPEAKING_START` and `SPEAKING_STOP` IPC events:
- **Top Bar Avatars**: The speaker's avatar instantly lights up with an animated glowing green border (`#23a55a`).
- **Popup Member List**: The participant row displays an active green halo around their avatar, allowing you to instantly identify who is talking even when 10+ people are in a chaotic Discord call.
- **Customizable Glow Color**: You can customize the glow hex color in Extension Preferences (e.g. Discord Green `#23a55a`, Cyan `#00d2ff`, Gold `#ffcc00`, or Magenta `#ff007f`).

---

## 3. Popup Menu & Voice Controls

Clicking the panel indicator with the left mouse button opens the voice control popup menu:

```text
┌────────────────────────────────────────────────────────┐
│  🔊 General Voice (Main Guild)                         │  <-- Active Channel & Server
│  Logged in as Alice                                    │  <-- Your Discord Profile
├────────────────────────────────────────────────────────┤
│  [✓] Mute Microphone                 [Hot: M-Click]    │  <-- Quick Mute Toggle
│  [ ] Deafen Audio                                      │  <-- Quick Deafen Toggle
│  🔀 Switch Channel: #gaming-room     (3/10)            │  <-- Channel Hopper Submenu
│  🚪 Leave Voice Channel               [Hot: R-Click]    │  <-- One-Click Disconnect
├────────────────────────────────────────────────────────┤
│  Participants (3)                                      │
│    👤 Alice (You)                                      │
│    👤 Bob         🎤 (Muted)                           │
│       ├─ Volume: [═══════════●══════] 120%   🔇 Mute   │  <-- Expandable Volume Slider
│    🤖 MusicBot    🔊 (Playing)                         │
├────────────────────────────────────────────────────────┤
│  🔌 Connection Controls (discord-ipc-0)                │  <-- Manual Socket Actions
│  ⚙️ Extension Settings...                              │  <-- Libadwaita Preferences
└────────────────────────────────────────────────────────┘
```

### 3.1 First-Time Setup: 1-Click Voice Authorization
Discord requires local authorization to allow third-party tools to inspect voice channels and control mute:
1. When you first click **Connect to Discord**, a prominent button appears:
   **`🔑 Authorize Voice Access (1-Click)`**
2. Click it. A Discord native popup opens: **"Authorize Discord StreamKit to access your Discord account"**.
3. Click **Authorize** inside Discord.
4. The extension automatically receives the OAuth2 token, saves it securely in your local user `gsettings`, and immediately renders your active voice channel!

---

## 4. Per-Participant Volume Sliders & User Mute

Have a teammate whose mic is too quiet, or someone whose microphone is deafening?
- Click on any participant's name in the popup menu to expand their individual audio controls.
- **Volume Slider**: Adjust the user's volume from **0% to 200%** (100% is normal volume). Changes take effect instantly in Discord without needing to switch windows (`SET_USER_VOICE_SETTINGS`).
- **Individual Mute Button**: Quickly silence a specific noisy participant without affecting everyone else in the call.

---

## 5. Quick Voice Channel Hopping

Need to hop from `#general` to `#gaming` or `#standup`?
- Under the channel header, click the **🔀 Switch Channel** menu item.
- It displays a list of all voice channels in your current server, complete with current occupancy (e.g. `#squad-1 (4/10)`).
- Click any channel to immediately move your voice call.

---

## 6. Quick Mouse Actions & Gestures

You can trigger voice actions directly from your mouse without even opening the menu:

| Mouse Input | Default Action | Configurable Options in Settings |
| :--- | :--- | :--- |
| **Middle-Click** (Button 2) | **Toggle Mute** | `Toggle Mute`, `Toggle Deafen`, `Leave Channel`, `Cycle Display Mode`, `Toggle Menu`, `None` |
| **Right-Click** (Button 3) | **Leave Voice Channel** | `Leave Channel`, `Toggle Mute`, `Toggle Deafen`, `Cycle Display Mode`, `Toggle Menu`, `None` |
| **Scroll Wheel** (Up/Down) | **Cycle Display Mode** | `Cycle Display Mode`, `Toggle Mute`, `None` |
| **Left-Click** (Button 1) | **Open / Close Menu** | Standard GNOME panel menu toggle |

> [!TIP]
> Setting **Middle-Click** to `Toggle Mute` turns the GNOME top bar into an instant desktop-wide mute toggle during video calls or gaming!

---

## 7. Stealth Mode (Auto-Hide)

If you love a clean, distraction-free desktop:
- Enable **Stealth Mode** in Extension Settings.
- When you are **not** in a voice call, the extension completely conceals itself from the top panel.
- The moment you join a voice room in Discord, the indicator reappears with participant avatars and controls.
- When you leave or disconnect, it vanishes cleanly again.

---

## 8. Configuration & Preferences Reference

Open preferences via GNOME top bar menu -> **⚙️ Extension Settings...** or the **Extensions** app (`gnome-extensions-app`).

### Taskbar Location & Appearance
- **Panel Section**: Position the indicator in the `Right`, `Center`, or `Left` section of the GNOME top bar.
- **Position Order Index**: Numerical position within the section (0 is closest to the corner/edge).
- **Taskbar Avatar Size**: Adjust avatar diameter between `16px` and `48px` (default `28px`).

### Dynamic Display Modes & Feedback
- **Top Panel Display Mode**: Switch between `Full Participant Avatars`, `Minimalist Status Pill`, or `Dynamic Speaking-Only`.
- **Stealth Mode**: Auto-hides extension when not in a voice call.
- **Speaking Glow Halo Color**: Hex color code for the speaking halo (default `#23a55a`).
- **Show Voice Participants in Taskbar**: Toggle avatar display on or off.
- **Max Taskbar Participant Avatars**: Set maximum number of visible avatars before overflow (`+N`) triggers (1 to 10).
- **Avatar-Only Mode**: Hide numeric text labels in the panel for a cleaner aesthetic.
- **Show When Disconnected**: Show dimmed icon when Discord is closed (ignored if Stealth Mode is enabled).

### Quick Mouse Actions
- Configure bindings for **Middle-Click**, **Right-Click**, and **Scroll Wheel**.

### Manual Discord IPC Connection
- **Socket Path**: Path to the Unix domain socket (`/run/user/1000/discord-ipc-0`).
- **Reset to Default**: Restores `$XDG_RUNTIME_DIR/discord-ipc-0`.
- **Connect on Extension Startup**: If enabled, auto-connects when GNOME Shell starts.
- **Discord Client ID**: OAuth2 client ID (defaults to official Discord StreamKit `207646673902501888`).
- **RPC Access Token**: OAuth2 token managed automatically via the 1-click button.

---

## 9. Frequently Asked Questions (FAQ) & Troubleshooting

### Q: Why does the panel say "Socket file not found"?
1. Verify that Discord Desktop is actively running.
2. Check your socket files in terminal:
   ```bash
   ls -la "$XDG_RUNTIME_DIR"/discord-ipc-*
   ```
3. If Discord is on `discord-ipc-1`, update **Socket Path** in Extension Settings.

### Q: Why does Flatpak Discord not connect?
Flatpak sandboxes isolate Unix sockets by default. Grant permission once:
```bash
flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord
```
Then restart Discord.

### Q: Can I use Vesktop or WebCord?
Vesktop uses `arRPC`, which only provides **Rich Presence** (showing what game you play). It does not implement Discord Voice RPC (`GET_SELECTED_VOICE_CHANNEL` or mute controls). For voice integration, use the official Discord client or our Mock server.

### Q: How do I test the extension without a Discord account?
Run the built-in mock server:
```bash
./run-mock-discord.sh
```
Then set **Socket Path** to `/tmp/discord-ipc-1` in Extension Settings and click **Connect**.
