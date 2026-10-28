# Discord Voice Panel — Manual Connection Guide

This guide explains how to connect the **Discord Voice Panel** GNOME Shell extension to your Discord Desktop client manually using Unix domain sockets.

---

## 1. Overview

On Linux, Discord Desktop communicates with local applications via Unix domain sockets named `discord-ipc-0` through `discord-ipc-9`. 

Because auto-detection is completely disabled, **you have full manual control** over:
1. Which exact socket path the extension connects to.
2. When the extension connects or disconnects.
3. Whether it connects on session startup or only when explicitly requested.

---

## 2. Locating Your Discord IPC Socket

Before connecting, you need to know the Unix domain socket path created by your running Discord client.

### Step 1: Make sure Discord is running
Open your Discord client and sign in to your account.

### Step 2: Find the socket path in a terminal
Run any of the following commands in your terminal:

```bash
# 1. Quick check in your user runtime directory:
ls -la $XDG_RUNTIME_DIR/discord-ipc*

# 2. Check for all Discord sockets under your user ID:
find /run/user/$(id -u)/ -name "discord-ipc*" 2>/dev/null

# 3. Check all active listening Unix domain sockets:
ss -xl | grep discord-ipc
```

Expected output example:
```
srwxr-xr-x 1 user user 0 Oct 27 12:00 /run/user/1000/discord-ipc-0
```

---

## 3. Common Socket Locations by Package Type

### A. Native Package (Arch Linux, Debian/Ubuntu `.deb`, Fedora `.rpm`, tar.gz)
- **Default Socket Path**:
  ```
  /run/user/1000/discord-ipc-0
  ```
  *(Replace `1000` with your user ID: `id -u`)*
- Alternatively, via environment variable:
  ```
  $XDG_RUNTIME_DIR/discord-ipc-0
  ```

### B. Official Flatpak Discord (`com.discordapp.Discord`)
Flatpak isolates the Discord application inside a sandbox. To allow the GNOME Shell extension to access the socket on your host desktop:

1. **Grant Flatpak IPC filesystem permission** (one-time command):
   ```bash
   flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord
   ```
2. **Restart Flatpak Discord**:
   ```bash
   flatpak kill com.discordapp.Discord
   flatpak run com.discordapp.Discord
   ```
3. **Socket Path**:
   Typically creates `/run/user/1000/discord-ipc-0` or:
   ```
   /run/user/1000/app/com.discordapp.Discord/discord-ipc-0
   ```

### C. Snap Discord (`snap.discord`)
Snap stores sockets in its runtime directory:
```
/run/user/1000/snap.discord/discord-ipc-0
```

### D. Discord Canary / PTB / Development
If you have multiple Discord builds open simultaneously:
- First client opened: `discord-ipc-0`
- Second client opened: `discord-ipc-1`
- Third client opened: `discord-ipc-2`

### E. Mock Discord IPC Server (For Testing / Offline Use)
You can run the included mock Discord server to test the extension without needing an active real Discord account or login:
```bash
./run-mock-discord.sh 1
```
The mock server listens on:
```
/run/user/1000/discord-ipc-1
```
*(or `$XDG_RUNTIME_DIR/discord-ipc-1`)*

> [!WARNING]
> **Important Note about Vesktop / arRPC**:
> Vesktop uses `arRPC` solely for Rich Presence (games). arRPC **does not implement Discord Voice RPC** (`GET_SELECTED_VOICE_CHANNEL` or mute/deafen controls). To see active voice participants and control microphone mute/deafen, you must connect to the **Official Discord Desktop client** or the included Mock server.

---

## 4. How to Connect Manually

### Method 1: Using the Top Bar Indicator Menu (Fastest)

1. Click the headset icon in the GNOME top bar.
2. The popup menu will display:
   - Status: **Discord is disconnected**
   - Target Socket: `Socket: /run/user/1000/discord-ipc-0` (or your configured path)
3. Click the green button: **🔌 Connect to Discord**.
4. The extension connects directly to that socket path:
   - Once connected, it will show your account name and current voice channel.
5. To disconnect manually at any time:
   - Open the menu, expand **Connection Controls**, and click **🔌 Disconnect from Discord**.

---

### Method 2: Using the Extension Preferences Window

1. Open the popup menu and click **Extension Settings...** (or run `gnome-extensions prefs discord-voice-panel@example.com`).
2. In the **Manual Discord IPC Connection** section:
   - **Socket Path**: Enter your exact Unix domain socket path (e.g. `/run/user/1000/discord-ipc-0` or `/run/user/1000/discord-ipc-1`).
   - If needed, click **Reset to Default** to restore `$XDG_RUNTIME_DIR/discord-ipc-0`.
   - **Connect on Extension Startup**: Turn this switch **ON** if you want the extension to automatically connect to this socket when logging into GNOME, or keep it **OFF** for purely manual on-demand connection.
3. Close Preferences and click **🔌 Connect to Discord** in the top bar.

---

### Method 3: Using the Terminal (GSettings CLI)

You can view and set your socket path directly via command-line:

```bash
# View current configured socket path:
gsettings get org.gnome.shell.extensions.discord-voice-panel manual-socket-path

# Set a custom socket path:
gsettings set org.gnome.shell.extensions.discord-voice-panel manual-socket-path '/run/user/1000/discord-ipc-0'

# Enable or disable connecting automatically when GNOME starts:
gsettings set org.gnome.shell.extensions.discord-voice-panel connect-on-startup false
```

---

## 5. One-Click Voice Authorization

When connecting to official Discord Desktop for the first time, Discord's security model requires a one-time authorization to allow the extension to read voice channel states and toggle mute/deafen.

1. Once connected, the top bar menu will show:
   **Discord Connected (Authorization Required)**
2. Click the blue button:
   **🔑 Authorize Voice Access (1-Click)**
3. The button will change to *⏳ Check Discord to approve...*
4. Bring your Discord Desktop window to the foreground. You will see an authorization dialog:
   > **Authorize Discord StreamKit Voice?**
   > - Access your voice settings
   > - Access your voice status
5. Click **Authorize** in Discord.
6. The extension instantly receives the token, saves it securely, and displays your active voice channel, mute/deafen switches, and participant avatars!

---

## 6. Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"Socket file not found"** | Discord is not running, or running with a different index. | Ensure Discord Desktop is open. Run `ls -la $XDG_RUNTIME_DIR/discord-ipc*` to find the exact file name and update your socket path in Settings. |
| **"Socket connect error: Connection refused"** | Stale socket file left behind after Discord crashed. | Close Discord, delete the stale socket file (`rm $XDG_RUNTIME_DIR/discord-ipc-*`), and restart Discord Desktop. |
| **"Flatpak socket not visible"** | Flatpak sandbox isolation prevents socket creation on host. | Run: `flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord` and restart Flatpak Discord. |
| **"arRPC: Voice Unsupported"** | Connected to Vesktop or standalone arRPC bridge. | arRPC only implements Rich Presence. Connect to Official Discord Desktop (or mock server) for voice channel features. |
| **"Sign-in required"** | Discord Desktop is running at the login/sign-in screen. | Sign in to your Discord account in the Discord app. |

---

## 7. Quick Testing with Mock Discord

To test manual connection right now on your machine without opening real Discord:

1. In a terminal, run:
   ```bash
   ./run-mock-discord.sh 1
   ```
2. Open **Extension Settings...** and enter:
   ```
   /run/user/1000/discord-ipc-1
   ```
   *(or `$XDG_RUNTIME_DIR/discord-ipc-1`)*
3. Click **🔌 Connect to Discord** in the top panel.
4. You will immediately see:
   - Status: `🔊 General Voice (Mock)`
   - Participants: `Fake Account Tester`, `Alice`, `Bob`
   - Working mute and deafen toggles!
