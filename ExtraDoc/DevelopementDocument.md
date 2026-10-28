# GNOME Shell Extension Development Documentation: Discord Voice Status Panel

**Target audience**: AI coding assistant
**Target system**: Arch Linux + GNOME Shell 45+ (ESM module system)
**Extension purpose**: Display the current Discord voice channel member count and list in the GNOME top bar, and provide mute/deafen toggle switches.

---

## 1. Project Overview

### 1.1 Functional Requirements

| ID  | Requirement                                                                                 | Priority |
| --- | ------------------------------------------------------------------------------------------- | -------- |
| F1  | Show a Discord voice channel icon and member count in the GNOME top bar                     | Must     |
| F2  | Clicking the icon opens a popup menu showing the current voice channel name and member list | Must     |
| F3  | Menu provides "Mute" and "Deafen" toggle switches, synced with Discord state                | Must     |
| F4  | UI updates in real time when members join/leave or mute state changes                       | Must     |
| F5  | Show "Not connected" state when Discord isn't running, without crashing                     | Must     |
| F6  | Provide preferences (e.g., show member count, refresh interval)                             | Optional |

### 1.2 Technical Constraints

- **GNOME Shell version**: 45 and above (use ESM `import`/`export`; the legacy `imports.*` syntax is forbidden).
- **GJS runtime**: The JavaScript engine bundled with GNOME Shell, supporting GObject Introspection.
- **Discord communication**: The local Unix Socket exposed by the Discord Desktop client (`discord-ipc-0` through `discord-ipc-9`), using the Discord RPC protocol.
- **No native Unix Socket support in GJS**: GJS has no direct Unix Socket API. You must use `Gio.SocketClient` or `Gio.UnixSocketAddress` to connect (**key challenge**, see Section 4).

---

## 2. Architecture Design

### 2.1 Module Breakdown

```
discord-voice-panel@example.com/
├── metadata.json
├── extension.js              # Entry point, lifecycle management
├── indicator.js              # Panel button and popup menu UI
├── discordRpc.js             # Discord IPC client (core)
├── rpcProtocol.js            # Frame encoding/decoding, opcode constants
├── auth.js                   # OAuth2 authorization flow (optional, if control permissions needed)
├── schemas/
│   └── org.gnome.shell.extensions.discord-voice-panel.gschema.xml
└── prefs.js                  # Preferences window
```

### 2.2 Data Flow

```
Discord Desktop
      │ Unix Socket (discord-ipc-N)
      ▼
discordRpc.js ──► parse frames ──► events (VOICE_STATE_*, VOICE_SETTINGS_UPDATE)
      │                                   │
      │ commands (GET_SELECTED_VOICE_CHANNEL, SET_VOICE_SETTINGS)
      ▼                                   ▼
indicator.js ◄── signals/callbacks ◄── state updates
      │
      ▼
GNOME Panel (PopupMenu + PanelMenu.Button)
```

---

## 3. Discord RPC Protocol Essentials

### 3.1 Connection Discovery

Discord IPC Socket locations (Linux):

- Check `discord-ipc-0` through `discord-ipc-9` in `XDG_RUNTIME_DIR`, `TMPDIR`, `TMP`, `TEMP`, and `/tmp`, in that order.
- Flatpak versions may be located under `$XDG_RUNTIME_DIR/app/com.discordapp.Discord/`.

### 3.2 Frame Format

Each IPC frame consists of an **8-byte header + JSON payload**:

| Offset | Length  | Content                                                  |
| ------ | ------- | -------------------------------------------------------- |
| 0      | 4 bytes | Opcode (little-endian u32): `0` = Handshake, `1` = Frame |
| 4      | 4 bytes | JSON payload length (little-endian u32)                  |
| 8      | N       | UTF-8 JSON string                                        |

**Parsing note**: You must handle packet coalescing/partial packets, accumulating data until a complete frame arrives.

### 3.3 Handshake

After connecting, send Opcode 0:

```json
{"v": 1, "client_id": "YOUR_DISCORD_APP_CLIENT_ID"}
```

Discord replies with a `DISPATCH` / `READY` event indicating the handshake succeeded.

### 3.4 Key RPC Commands

| Command                      | Purpose                                               | Args                               |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------- |
| `GET_SELECTED_VOICE_CHANNEL` | Get the current voice channel (including member list) | None                               |
| `GET_VOICE_SETTINGS`         | Read mute/deafen state                                | None                               |
| `SET_VOICE_SETTINGS`         | Set mute/deafen                                       | `{mute: bool, deaf: bool}`         |
| `SUBSCRIBE`                  | Subscribe to events                                   | `{evt: "VOICE_STATE_CREATE"}` etc. |

### 3.5 Key RPC Events (must subscribe)

| Event                   | Trigger                              | Key payload fields                 |
| ----------------------- | ------------------------------------ | ---------------------------------- |
| `VOICE_CHANNEL_SELECT`  | User joins/leaves a voice channel    | `channel_id`, `guild_id`           |
| `VOICE_STATE_CREATE`    | A member joins the voice channel     | `user`, `voice_state`              |
| `VOICE_STATE_UPDATE`    | A member's mute/deafen state changes | `user.id`, `voice_state.mute/deaf` |
| `VOICE_STATE_DELETE`    | A member leaves the voice channel    | `user.id`                          |
| `VOICE_SETTINGS_UPDATE` | Local mute/deafen changes            | `mute`, `deaf`                     |

---

## 4. Key Technical Challenges and Solutions

### 4.1 Unix Socket Connections in GJS

**Problem**: GJS has no direct `net.connect('/path/to/socket')` API.

**Approach A (recommended)**: Use `Gio.SocketClient` + `Gio.UnixSocketAddress`

```javascript
import Gio from 'gi://Gio';

const address = Gio.UnixSocketAddress.new(path);
const client = new Gio.SocketClient();
const connection = client.connect(address, null); // synchronous connect, must be non-blocking or acceptable
const inputStream = connection.get_input_stream();
const outputStream = connection.get_output_stream();
```

**Note**: `connect()` is synchronous and blocking. Calling it on the GNOME Shell main thread may cause UI stutter. Recommendations:

- Perform the connect in `enable()`, but set a short timeout (`Gio.SocketClient.set_timeout()`).
- Or use `connect_async()` wrapped in a Promise.

**Approach B (fallback)**: Write a lightweight DBus daemon (Python/Node.js) to handle RPC, and have the extension communicate with it via DBus. **This approach is more stable but adds deployment complexity**. This document focuses on Approach A.

### 4.2 OAuth2 Authorization and Permissions

**Key limitation**: Discord currently **does not allow unapproved applications to access RPC control commands** (such as `SET_VOICE_SETTINGS`). Developers must create an application in the Discord Developer Portal and can add up to 50 testers. Users on the tester list can use the authorization flow.

**Flow**:

1. Create an Application in the Discord Developer Portal, obtain the `client_id`.
2. On first run, the extension completes OAuth2 authorization via the `AUTHORIZE` RPC command or an external browser, obtaining an `access_token`.
3. Subsequent RPC commands carry the token in the `AUTHENTICATE` frame.

**Simplified approach**: If only **reading** voice channel info (member list, mute state) is needed, some RPC commands may not require full OAuth2, but `GET_SELECTED_VOICE_CHANNEL` still requires the `rpc` scope. It's recommended to explicitly state in the documentation: **Control features (mute toggling) require the Discord app to be approved or the user to be added as a tester**.

### 4.3 Robust Frame Parsing

The Discord IPC stream may return multiple frames at once or half a frame. Reference implementation:

```javascript
let buffer = Buffer.alloc(0);
let expectedLength = 0;
let currentOpcode = null;

function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
        if (expectedLength === 0) {
            currentOpcode = buffer.readUInt32LE(0);
            expectedLength = buffer.readUInt32LE(4);
            buffer = buffer.subarray(8);
        }
        if (buffer.length < expectedLength) break;
        const payload = JSON.parse(buffer.subarray(0, expectedLength).toString());
        buffer = buffer.subarray(expectedLength);
        expectedLength = 0;
        handlePayload(currentOpcode, payload);
    }
}
```

---

## 5. GNOME Shell Extension Implementation Specification

### 5.1 metadata.json

```json
{
    "uuid": "discord-voice-panel@example.com",
    "name": "Discord Voice Panel",
    "description": "Show Discord voice channel members in the top bar and toggle mute/deafen.",
    "shell-version": ["45", "46", "47", "48"],
    "url": "https://github.com/yourname/discord-voice-panel",
    "settings-schema": "org.gnome.shell.extensions.discord-voice-panel"
}
```

### 5.2 Entry Class (extension.js)

Must extend `Extension` and export as default:

```javascript
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DiscordVoiceIndicator } from './indicator.js';

export default class DiscordVoicePanelExtension extends Extension {
    enable() {
        this._indicator = new DiscordVoiceIndicator(this);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
```

### 5.3 Panel Button and Menu (indicator.js)

Use `PanelMenu.Button` and `PopupMenu`:

```javascript
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class DiscordVoiceIndicator {
    constructor(extension) {
        this._extension = extension;
        this._button = new PanelMenu.Button(0.0, 'Discord Voice', false);

        // Icon + member count label
        this._icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon'
        });
        this._countLabel = new St.Label({ text: '', y_align: 1 }); // CENTER
        const box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._countLabel);
        this._button.add_child(box);

        // Menu items (updated dynamically)
        this._menu = this._button.menu;

        Main.panel.addToStatusArea(extension.uuid, this._button);

        // Initialize RPC
        this._initRpc();
    }

    _initRpc() {
        // Connect to Discord and register event callbacks
        // See Section 4 for details
    }

    updateMemberList(members) {
        this._countLabel.set_text(members.length > 0 ? ` ${members.length}` : '');
        // Clear and rebuild member items in the menu...
    }

    destroy() {
        this._button.destroy();
    }
}
```

### 5.4 Mute/Deafen Toggle Menu Items

Use `PopupSwitchMenuItem`:

```javascript
const muteItem = new PopupMenu.PopupSwitchMenuItem('Mute', false);
muteItem.connect('toggled', (item, state) => {
    // Send SET_VOICE_SETTINGS
    rpc.sendCommand('SET_VOICE_SETTINGS', { mute: state });
});
this._menu.addMenuItem(muteItem);
```

**Note**: You must sync state changes from the Discord side (via the `VOICE_SETTINGS_UPDATE` event) to avoid an infinite loop when the UI and Discord disagree. Use a `_suppressToggle` flag.

### 5.5 Resource Cleanup

In `disable()`, you must:

- Disconnect the Socket.
- Cancel all `GLib.timeout_add` / `Gio.Cancellable`.
- Destroy the panel button.
- Disconnect signal handlers.

---

## 6. Error Handling and Edge Cases

| Scenario                     | Behavior                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| Discord not running          | Show gray icon; menu shows "Discord is not running"; don't throw exceptions |
| Connection drops mid-session | Clean up resources; update status to Disconnected with manual Connect button |
| User not in a voice channel  | Hide member count; menu shows "Not in a voice channel"                      |
| RPC authorization fails      | Menu shows error message with a "Re-authorize" button                       |
| Frame parsing error          | Log; close connection and reconnect                                         |
| GNOME Shell lock/unlock      | Listen for `SessionMode` changes; pause/resume the RPC connection           |

---

## 7. Arch Linux Development Environment Setup

### 7.1 Install Dependencies

```bash
sudo pacman -S gnome-shell nodejs npm git
# Optional: for TypeScript type hints
npm install -g typescript
```

### 7.2 Debugging

**Nested Wayland session** (avoids crashing your main desktop):

```bash
# GNOME 48 and below
dbus-run-session gnome-shell --nested --wayland

# GNOME 49+
dbus-run-session gnome-shell --devkit --wayland
```

Enable the extension in the nested session:

```bash
gnome-extensions enable discord-voice-panel@example.com
```

View logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

### 7.3 Symlink Installation (for development)

```bash
ln -s ~/dev/discord-voice-panel ~/.local/share/gnome-shell/extensions/discord-voice-panel@example.com
```

---

## 8. AI Development Instructions (Explicit Task List for the Code-Generating Model)

Please generate code in the following order:

1. **`metadata.json`**: Use the content in Section 5.1.
2. **`rpcProtocol.js`**:
   - Export `OP_HANDSHAKE = 0`, `OP_FRAME = 1`.
   - Implement `encodeFrame(opcode, jsonObject)` returning a `Uint8Array`.
   - Implement a `FrameDecoder` class with a `feed(chunk)` method returning parsed `{opcode, data}` entries.
3. **`discordRpc.js`**:
   - Class `DiscordRpcClient`.
   - Method `connect()`: iterate over socket paths, connect using `Gio.SocketClient`, send the handshake.
   - Method `sendCommand(cmd, args)`: send an Opcode 1 frame; return a Promise resolved via nonce matching.
   - Event `connect('voice-state-changed', callback)`: fire when `VOICE_STATE_*` or `VOICE_CHANNEL_SELECT` is received; callback receives the current channel and member list.
   - Method `disconnect()`: clean up socket, streams, and callbacks.
4. **`indicator.js`**:
   - Create the panel button per Section 5.3.
   - Connect to `DiscordRpcClient` events; update member count and menu.
   - Add mute/deafen switches that call `sendCommand('SET_VOICE_SETTINGS', ...)`.
   - Handle `VOICE_SETTINGS_UPDATE` to update switch state (loop prevention).
5. **`extension.js`**: Per Section 5.2.
6. **`prefs.js`** (optional): Use `Adw.PreferencesPage` to provide "auto-reconnect interval" and "show member count" switches.

**Important reminders**:

- All `import` statements must use ESM syntax; `imports.gi` or `imports.misc` must not appear.
- All `Gio.SocketClient` operations should be asynchronous (`connect_async()`, `read_bytes_async()`). Never set a persistent socket I/O timeout via `Gio.SocketClient.set_timeout()` on persistent IPC streams, as that causes stream reads to fail with `Socket I/O timed out` whenever the connection is idle. Use GLib timeout guards for connection phases instead.
- If the OAuth2 flow cannot be completed in a browserless environment, implement **read-only mode first** (`GET_SELECTED_VOICE_CHANNEL` + event subscription), and mark control features with `// TODO: requires Discord app approval`.

---

## 9. Reference Resources

- Discord RPC official docs: https://docs.discord.com/developers/topics/rpc
- GNOME Shell 45 ESM migration guide: https://gjs.guide/extensions/upgrading/gnome-shell-45.html
- PopupMenu component docs: https://gjs.guide/extensions/topics/popup-menu.html
- Discord IPC frame format reference (Rust): https://github.com/luohoa97/cordial
- GSettings preferences: https://gjs.guide/extensions/development/preferences.html
