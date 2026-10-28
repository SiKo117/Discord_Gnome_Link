---
name: Bug Report
about: Report an issue or bug encountered with Discord Voice Panel
title: "[BUG] "
labels: bug
assignees: ''

---

> **Note**: This project was generated with AI assistance and is shared "as-is" for personal use. Maintenance is not guaranteed, but bug reports and pull requests are welcomed by the open-source community!

### Describe the Bug
A clear and concise description of what the bug is.

### Steps to Reproduce
1. Start Discord client (`Native` / `Flatpak` / `Snap`)
2. Connect extension via top panel
3. Perform action '...'
4. See error

### Expected Behavior
A clear and concise description of what you expected to happen.

### Environment & System Details
- **GNOME Shell Version**: (e.g. 45, 46, 47, 48, 49, 50, 51)
- **Linux Distribution**: (e.g. Arch Linux, Fedora 40, Ubuntu 24.04)
- **Session Type**: Wayland / X11
- **Discord Version & Packaging**: (e.g. Native deb/rpm/pacman, Flatpak `com.discordapp.Discord`, Vesktop)
- **Extension Version**: (from `metadata.json`)

### GNOME Shell Log Output
Run the following command in terminal and paste relevant lines:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i DiscordVoice
```

### Additional Context
Add any other context, screenshots, or logs here.
