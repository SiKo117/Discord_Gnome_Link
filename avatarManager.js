import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { getAvatarUrl, getAvatarCacheFilename } from './avatarUtils.js';

export { getAvatarUrl, getAvatarCacheFilename };

/**
 * AvatarManager handles downloading, disk caching, and retrieving Discord avatar images.
 */
export class AvatarManager {
    constructor() {
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'discord-voice-panel', 'avatars']);
        this._ensureCacheDir();
        this._inFlightDownloads = new Map(); // url -> Promise<string|null>
        this._session = Soup ? new Soup.Session() : null;
    }

    _ensureCacheDir() {
        try {
            const dir = Gio.File.new_for_path(this._cacheDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
        } catch (e) {
            console.warn(`[DiscordVoice][AvatarManager] Cache dir error: ${e.message}`);
        }
    }

    /**
     * Get the cached disk path for a user's avatar, downloading it asynchronously if needed.
     *
     * @param {object|null} user - Discord user object
     * @param {number} [size=64] - Target image resolution
     * @returns {Promise<string|null>} Absolute local file path or null
     */
    async fetchAvatar(user, size = 64) {
        if (!user) return null;

        const filename = getAvatarCacheFilename(user);
        const localPath = GLib.build_filenamev([this._cacheDir, filename]);
        const file = Gio.File.new_for_path(localPath);

        // Check if already cached on disk
        if (file.query_exists(null)) {
            try {
                const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                if (info && info.get_size() > 0) {
                    return localPath;
                }
            } catch (_) {}
        }

        const url = getAvatarUrl(user, size);
        if (!url) return null;

        // Reuse in-flight download if already downloading
        if (this._inFlightDownloads.has(url)) {
            return this._inFlightDownloads.get(url);
        }

        const downloadPromise = this._downloadImage(url, localPath);
        this._inFlightDownloads.set(url, downloadPromise);

        try {
            const result = await downloadPromise;
            return result;
        } finally {
            this._inFlightDownloads.delete(url);
        }
    }

    async _downloadImage(url, targetPath) {
        const file = Gio.File.new_for_path(targetPath);

        // Helper to asynchronously write GLib.Bytes to target file
        const writeBytesAsync = async (bytes) => {
            await new Promise((resolve, reject) => {
                file.replace_contents_bytes_async(
                    bytes,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                    (f, res) => {
                        try {
                            f.replace_contents_finish(res);
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    }
                );
            });
        };

        // 1. Try global fetch if available
        if (typeof globalThis.fetch === 'function') {
            try {
                const res = await globalThis.fetch(url);
                if (res.ok) {
                    const buf = await res.arrayBuffer();
                    const uint8 = new Uint8Array(buf);
                    if (uint8.length > 0) {
                        const glibBytes = new GLib.Bytes(uint8);
                        await writeBytesAsync(glibBytes);
                        return targetPath;
                    }
                }
            } catch (_) {}
        }

        // 2. Try Soup 3.0
        if (this._session) {
            try {
                const msg = Soup.Message.new('GET', url);
                const bytes = await new Promise((resolve, reject) => {
                    this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                        try {
                            resolve(s.send_and_read_finish(res));
                        } catch (err) {
                            reject(err);
                        }
                    });
                });

                const status = msg.get_status ? msg.get_status() : msg.status_code;
                if (status === 200 && bytes && bytes.get_size() > 0) {
                    await writeBytesAsync(bytes);
                    return targetPath;
                }
            } catch (_) {}
        }

        // 3. Fallback to curl subprocess
        try {
            const proc = Gio.Subprocess.new(
                ['curl', '-s', '-S', '-L', '-m', '10', '-o', targetPath, url],
                Gio.SubprocessFlags.NONE
            );
            await new Promise((resolve, reject) => {
                proc.wait_async(null, (p, res) => {
                    try {
                        p.wait_finish(res);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            if (file.query_exists(null)) {
                const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                const hasValidSize = info && info.get_size() > 0;
                const exitSuccess = !proc.get_if_exited() || proc.get_exit_status() === 0;

                if (hasValidSize && exitSuccess) {
                    return targetPath;
                } else {
                    try {
                        file.delete(null);
                    } catch (_) {}
                }
            }
        } catch (_) {}

        return null;
    }
}

/**
 * Singleton AvatarManager instance
 */
let _avatarManagerInstance = null;
export function getAvatarManager() {
    if (!_avatarManagerInstance) {
        _avatarManagerInstance = new AvatarManager();
    }
    return _avatarManagerInstance;
}

/**
 * Circular Avatar St widget that displays a Discord user's profile picture with fallback icon.
 */
export const AvatarWidget = GObject.registerClass(
class AvatarWidget extends St.Bin {
    _init(avatarManager, size = 32, options = {}) {
        const radius = Math.round(size / 2);
        super._init({
            style_class: options.style_class || 'discord-avatar',
            width: size,
            height: size,
            can_focus: false,
            reactive: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._avatarManager = avatarManager || getAvatarManager();
        this._size = size;
        this._radius = radius;
        this._currentUser = null;
        this._cachedImagePath = null;
        this._borderColor = options.borderColor || 'transparent';
        this._glowColor = options.glowColor || '#23a55a';
        this._isSpeaking = false;
        this._destroyed = false;
        this.connect('destroy', () => {
            this._destroyed = true;
            this._currentUser = null;
            this._cachedImagePath = null;
        });

        // Fallback symbolic icon
        this._fallbackIcon = new St.Icon({
            icon_name: options.fallbackIcon || 'avatar-default-symbolic',
            icon_size: Math.max(10, size - 8),
            style_class: 'discord-avatar-fallback-icon',
        });
        this.set_child(this._fallbackIcon);

        this._updateStyle(null);
    }

    setSize(size) {
        if (this._destroyed) return;
        const newSize = Math.max(12, Math.round(size));
        if (this._size === newSize) return;
        this._size = newSize;
        this._radius = Math.round(newSize / 2);
        this.width = newSize;
        this.height = newSize;
        if (this._fallbackIcon) {
            this._fallbackIcon.icon_size = Math.max(10, newSize - 8);
        }
        this._updateStyle(this._cachedImagePath);
    }

    _updateStyle(imagePath = null) {
        if (this._destroyed) return;
        try {
            const activeColor = this._isSpeaking ? this._glowColor : this._borderColor;
            const borderStyle = activeColor !== 'transparent'
                ? `border: 2px solid ${activeColor};`
                : 'border: 2px solid transparent;';
            const shadowStyle = this._isSpeaking
                ? `box-shadow: 0 0 8px ${this._glowColor};`
                : '';

            if (imagePath) {
                this.set_style(`
                    width: ${this._size}px;
                    height: ${this._size}px;
                    border-radius: ${this._radius}px;
                    background-image: url("file://${imagePath}");
                    background-size: cover;
                    ${borderStyle}
                    ${shadowStyle}
                `);
                if (this._fallbackIcon) {
                    this._fallbackIcon.visible = false;
                }
            } else {
                this.set_style(`
                    width: ${this._size}px;
                    height: ${this._size}px;
                    border-radius: ${this._radius}px;
                    background-color: #5865F2;
                    ${borderStyle}
                    ${shadowStyle}
                `);
                if (this._fallbackIcon) {
                    this._fallbackIcon.visible = true;
                }
            }
        } catch (_) {}
    }

    setSpeaking(isSpeaking, glowColor = null) {
        if (this._destroyed) return;
        this._isSpeaking = Boolean(isSpeaking);
        if (glowColor) {
            this._glowColor = glowColor;
        }
        if (this._isSpeaking) {
            this.add_style_class_name('is-speaking');
        } else {
            this.remove_style_class_name('is-speaking');
        }
        this._updateStyle(this._cachedImagePath);
    }

    get isSpeaking() {
        return this._isSpeaking;
    }

    setUser(user) {
        if (this._destroyed) return;
        if (this._currentUser === user && this._cachedImagePath) {
            this._updateStyle(this._cachedImagePath);
            return;
        }

        this._currentUser = user;
        this._cachedImagePath = null;

        if (!user) {
            this._updateStyle(null);
            return;
        }

        // Check if cached or trigger fetch
        this._avatarManager.fetchAvatar(user, this._size * 2).then(localPath => {
            if (this._destroyed || this._currentUser !== user) return;
            this._cachedImagePath = localPath;
            if (localPath) {
                this._updateStyle(localPath);
            }
        }).catch(() => {});
    }

    setBorderColor(color) {
        if (this._destroyed) return;
        this._borderColor = color || 'transparent';
        this._updateStyle(this._cachedImagePath);
    }

    setDimmed(dimmed) {
        if (this._destroyed) return;
        try {
            this.opacity = dimmed ? 130 : 255;
        } catch (_) {}
    }

    destroy() {
        this._destroyed = true;
        this._currentUser = null;
        this._cachedImagePath = null;
        super.destroy();
    }
});
