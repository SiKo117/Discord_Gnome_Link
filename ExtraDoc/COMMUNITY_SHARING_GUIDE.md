# Community Sharing Guide: Discord Voice Panel

This guide provides a comprehensive roadmap for sharing the **Discord Voice Panel** GNOME Shell extension with the wider Linux, GNOME, and open-source communities.

---

## Table of Contents
1. [Pre-Flight Checklist (Crucial First Steps)](#1-pre-flight-checklist-crucial-first-steps)
2. [Step 1: Publishing on GitHub](#step-1-publishing-on-github)
3. [Step 2: Submitting to extensions.gnome.org (EGO)](#step-2-submitting-to-extensionsgnomeorg-ego)
4. [Step 3: Creating an Arch User Repository (AUR) Package](#step-3-creating-an-arch-user-repository-aur-package)
5. [Step 4: Announcing to the Community](#step-4-announcing-to-the-community)
6. [Step 5: Managing Community Feedback & Expectations](#step-5-managing-community-feedback--expectations)

---

## 1. Pre-Flight Checklist (Crucial First Steps)

Before publishing publicly or submitting to the official GNOME Extensions directory, complete these checklist items:

### 1.1 Choose Your Unique Extension UUID
The current default UUID is `discord-voice-panel@example.com`. 

> [!WARNING]
> The GNOME Extensions review team at `extensions.gnome.org` will **reject** submissions using `@example.com` because UUIDs must be unique across the entire ecosystem.

The standard convention is to use your personal domain or GitHub username:
- Example format: `discord-voice-panel@<your-github-username>.github.io`
- Or: `discord-voice-panel@<your-domain-or-alias>`

If you change the UUID, update it in these files:
- `metadata.json` (`"uuid"` field)
- `Makefile` (`UUID = ...` at line 1)
- `install.sh`, `update.sh`, `uninstall.sh`
- `schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml` (if you rename the schema path)

### 1.2 Update Repository URL in `metadata.json`
Open `metadata.json` and replace the placeholder URL with your real GitHub repository URL:
```json
{
    "uuid": "discord-voice-panel@yourusername.github.io",
    "name": "Discord Voice Panel",
    "description": "Show Discord voice channel members, speaking halo, and volume controls in the top bar.",
    "shell-version": ["45", "46", "47", "48", "49", "50", "51"],
    "url": "https://github.com/YOUR_USERNAME/discord-voice-panel",
    "settings-schema": "org.gnome.shell.extensions.discord-voice-panel",
    "gettext-domain": "discord-voice-panel",
    "version": 1
}
```

### 1.3 Add Screenshots & Demo Media
Visuals are the #1 driver of adoption for GNOME extensions:
1. Capture screenshots of:
   - Top panel indicator in **Avatar Mode** with the green **Speaking Glow Halo**.
   - Top panel indicator in **Minimalist Status Pill Mode**.
   - The expanded **Voice Menu** showing active participants, volume sliders, and mute/deafen switches.
   - The modern **Libadwaita Preferences** window.
2. Store images in an `assets/` or `screenshots/` directory.
3. Link them in `README.md`.

---

## 2. Step 1: Publishing on GitHub

### 2.1 Initialize Git & Make Initial Commit
Open a terminal in your project directory:

```bash
cd /home/arch/shared/jcodeprojects/DiscordGnomeExtension

# Initialize git repository
git init

# Check git status (ignored files like .zip and compiled schemas are auto-excluded by .gitignore)
git status

# Stage all files
git add .

# Create the initial commit
git commit -m "feat: initial commit of Discord Voice Panel extension"

# Set default branch to main
git branch -M main
```

### 2.2 Link and Push to GitHub
1. Go to [GitHub New Repository](https://github.com/new).
2. Repository name: `discord-voice-panel` (or your preferred name).
3. Set visibility to **Public**.
4. Leave *"Initialize with README / .gitignore / license"* unchecked (since we already have them locally).
5. Copy the remote URL and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/discord-voice-panel.git
git push -u origin main
```

### 2.3 Create a GitHub Release with Distributable `.zip`
1. Build the zip archive:
   ```bash
   make pack
   ```
2. In your GitHub repository:
   - Click **Releases** -> **Draft a new release**.
   - Tag version: `v1.0.0`
   - Release title: `v1.0.0 - Initial Release (GNOME 45–51)`
   - Describe features (Speaking glow, volume sliders, channel hopping, stealth mode, Wayland async I/O).
   - Drag and drop `discord-voice-panel@...shell-extension.zip` into the binaries section.
   - Click **Publish release**.

Users can now download the `.zip` and install it in one command:
```bash
gnome-extensions install --force discord-voice-panel@...shell-extension.zip
```

---

## 3. Step 2: Submitting to extensions.gnome.org (EGO)

**extensions.gnome.org (EGO)** is the official repository where all GNOME users browse, search, and 1-click install extensions.

### 3.1 Sign Up / Log In
1. Visit [extensions.gnome.org](https://extensions.gnome.org/).
2. Click **Register** or **Log In** (supports GNOME GitLab OAuth).

### 3.2 Prepare Your Archive
Always build using the official `gnome-extensions pack` tool via our Makefile:

```bash
make pack
```

Verify that the `.zip` includes only source files:
- `metadata.json`
- `extension.js`, `prefs.js`, `indicator.js`, `discordRpc.js`, `rpcProtocol.js`, `socketUtils.js`, `avatarUtils.js`, `avatarManager.js`
- `stylesheet.css`
- `schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml`
- `schemas/gschemas.compiled`

### 3.3 Upload to EGO
1. Go to: [extensions.gnome.org/upload/](https://extensions.gnome.org/upload/)
2. Upload your `.shell-extension.zip` file.
3. Review the extracted metadata (UUID, name, description, shell versions).
4. Submit for review!

### 3.4 What the GNOME Review Team Checks:
The GNOME Extension review team conducts automated and manual reviews against safety and quality standards:
- [x] **No Synchronous I/O**: The extension uses non-blocking `Gio.SocketClient` (`connect_async`, `read_bytes_async`, `write_bytes_async`). GNOME Shell is never blocked.
- [x] **Clean `disable()`**: When disabled or reloaded, all timers, socket connections, and signal listeners are disconnected.
- [x] **Strict ESM**: Modern `import`/`export` with no deprecated `imports.*` syntax.
- [x] **Schema Validation**: GSettings schemas compile cleanly without warnings.
- [x] **No Malicious Code / Eval**: No `eval()`, obfuscation, or unauthorized telemetry.

### 3.5 Review Timeline & Updates
- Initial review typically takes between **3 to 14 days**.
- If a reviewer leaves feedback, you can reply directly in the review conversation on EGO.
- To submit a patch or update:
  1. Increment `"version"` in `metadata.json` (e.g. from `1` to `2`).
  2. Run `make pack`.
  3. Upload the new zip file to your extension page on EGO.

---

## 4. Step 3: Creating an Arch User Repository (AUR) Package

Arch Linux users love installing extensions via `pacman` / `yay` / `paru`. You can create an AUR package `gnome-shell-extension-discord-voice-panel-git`.

### Example `PKGBUILD` Template:
```bash
# Maintainer: Your Name <your.email@example.com>
pkgname=gnome-shell-extension-discord-voice-panel-git
pkgver=1.0.0.r0.g1234567
pkgrel=1
pkgdesc="GNOME Shell extension displaying Discord voice participants, mute/deafen, and volume controls in the top bar."
arch=('any')
url="https://github.com/YOUR_USERNAME/discord-voice-panel"
license=('GPL-3.0-or-later')
depends=('gnome-shell>=45' 'glib2')
makedepends=('git')
provides=("${pkgname%-git}")
conflicts=("${pkgname%-git}")
source=("git+https://github.com/YOUR_USERNAME/discord-voice-panel.git")
sha256sums=('SKIP')

_uuid="discord-voice-panel@yourusername.github.io"

pkgver() {
    cd "${srcdir}/discord-voice-panel"
    git describe --long --tags 2>/dev/null | sed 's/^v//;s/\([^-]*-g\)/r\1/;s/-/./g' ||
    printf "1.0.0.r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
}

build() {
    cd "${srcdir}/discord-voice-panel"
    make build
}

package() {
    cd "${srcdir}/discord-voice-panel"
    local destdir="${pkgdir}/usr/share/gnome-shell/extensions/${_uuid}"
    install -d "${destdir}"
    
    install -m644 metadata.json extension.js indicator.js discordRpc.js \
                  rpcProtocol.js socketUtils.js avatarUtils.js avatarManager.js \
                  prefs.js stylesheet.css "${destdir}/"

    install -d "${destdir}/schemas"
    install -m644 schemas/*.xml "${destdir}/schemas/"

    install -d "${pkgdir}/usr/share/glib-2.0/schemas"
    install -m644 schemas/*.xml "${pkgdir}/usr/share/glib-2.0/schemas/"
}
```

To submit to the AUR:
1. Register on [aur.archlinux.org](https://aur.archlinux.org/).
2. Set up SSH authentication.
3. Push the `PKGBUILD` and `.SRCINFO` to your AUR git repository.

---

## 5. Step 4: Announcing to the Community

Once the extension is published on GitHub and submitted to EGO, share it with Linux enthusiasts:

### 5.1 Reddit Posts
- **r/gnome**: Best place for GNOME users and extension enthusiasts.
  - *Title format*: `[Extension] Discord Voice Panel: View voice participants, speaking glow, and volume sliders in your top bar (GNOME 45-51 / Wayland)`
  - *Post content*: Explain why you made it (Wayland-native Discord overlay alternative, no frame-drops during gaming, asynchronous IPC), link the GitHub repo, and include a video/screenshot.
- **r/linux**: For broader Linux community news.
- **r/unixporn**: Post a screenshot of your clean desktop setup with the minimalist pill or avatar indicator.
- **r/discordapp**: For Linux users asking for Discord overlay alternatives on Wayland.

### 5.2 GNOME Discourse
- Visit [discourse.gnome.org](https://discourse.gnome.org/).
- Post in the **Extensions** category to get feedback from other extension developers and GNOME contributors.

### 5.3 Linux Gaming Communities
- Linux gamers on Wayland struggle with Discord's built-in overlay (which is broken under Wayland).
- Share the project in forums like **GamingOnLinux**, **ProtonDB Discord**, or Linux gaming subreddits.

---

## 6. Step 5: Managing Community Feedback & Expectations

Because the project includes an AI disclaimer and is provided "as-is" for personal use:

1. **Be Honest & Transparent**:
   - The disclaimer in `README.md` and `CONTRIBUTING.md` sets clear expectations: no formal SLA or guaranteed maintenance.
   - Community members appreciate knowing this upfront.

2. **Empower the Community to Fork**:
   - If you don't have time to implement a requested feature or debug a niche issue, warmly encourage community members:
     > *"Thanks for the suggestion! As mentioned in the README, this is a personal project. You are more than welcome to submit a Pull Request or fork the repository to add this!"*

3. **Enjoy the Collaboration**:
   - Open source is about sharing. Even without maintaining a 24/7 issue tracker, your code will help hundreds of Linux gamers and engineers enjoy seamless Discord voice integration on GNOME!
