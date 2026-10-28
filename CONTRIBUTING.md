# Contributing to Discord Voice Panel

Thank you for your interest in contributing to **Discord Voice Panel**!

---

## ⚠️ Project Status & Disclaimer

> **Important**: This project was originally created with AI assistance for personal use. The author provides no warranty, is not liable for any issues, and does not provide active maintenance or SLA support. 
> 
> **You are completely free and encouraged to fork, modify, improve, distribute, or maintain your own version under the terms of the GNU General Public License v3.0 (GPLv3).**

Pull requests with bug fixes, GNOME version updates, or new features are welcomed!

---

## 🛠️ Development Setup

### 1. Prerequisites
- **Linux** with **GNOME Shell 45 through 51** (Wayland or X11)
- **Node.js** (v18+ recommended) for running test suites and the mock RPC server
- **GLib tools** (`glib-compile-schemas` via `libglib2.0-dev-bin` or `glib2`)
- **Git**

### 2. Clone Your Fork
```bash
git clone https://github.com/YOUR_USERNAME/discord-voice-panel.git
cd discord-voice-panel
```

### 3. Symlink into GNOME Extensions (Developer Mode)
Use the symlink installation mode so changes to source code take effect immediately upon session reload:

```bash
make link
make enable
```
*(Or run `./install.sh --link`)*

---

## 🧪 Testing

### Running Unit Tests
The project contains an extensive unit test suite covering protocol framing, little-endian binary header handling, packet coalescing, OAuth2 authorization, avatar calculation, and participant lifecycles:

```bash
make test
# or: npm test
```

### Testing with the Mock Discord IPC Server
You do not need a live Discord account to test voice events, mute/deafen toggles, and participant lists:

```bash
# Terminal 1: Launch mock RPC server
npm run mock
# (or: ./run-mock-discord.sh)
```

In GNOME Shell:
1. Open Extension Settings.
2. Set **Socket Path** to `/tmp/discord-ipc-1` (or your `$XDG_RUNTIME_DIR/discord-ipc-1`).
3. Click **Connect to Discord** in the panel. The extension will connect to the simulated call!

### Inspecting Logs
To monitor live extension logs, connection state changes, and socket payloads:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i DiscordVoice
```

---

## 📐 Architecture & Coding Guidelines

- **ESM Modules Only**: GNOME Shell 45+ strictly uses ECMAScript modules (`import`/`export`). Legacy `imports.*` syntax is prohibited.
- **Asynchronous Non-Blocking I/O**: All socket reads, writes, and connections must use asynchronous Gio APIs (`connect_async`, `read_bytes_async`, `write_bytes_async`). Never use synchronous calls that block the GNOME Shell main loop.
- **Clean Lifecycle**:
  - `enable()` must allocate all resources and connect signals.
  - `disable()` must disconnect all signal handlers, destroy UI actors, close open sockets, and set references to `null` to prevent memory leaks.
- **Strict Schema Validation**:
  - Any new GSettings key added to `schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml` must pass:
    ```bash
    glib-compile-schemas --strict schemas/
    ```

---

## 📦 Packaging

To generate a clean `.zip` bundle for testing or distribution:

```bash
make pack
```

This compiles GSettings schemas and packages all extension source files into:
`discord-voice-panel@example.com.shell-extension.zip`

---

## 🤝 Submitting Changes

1. Fork the repository.
2. Create a topic branch: `git checkout -b feature/my-new-feature`
3. Commit your changes with clear, descriptive commit messages.
4. Verify that all tests pass (`make test`).
5. Push to your branch: `git push origin feature/my-new-feature`
6. Open a Pull Request against `main`.
