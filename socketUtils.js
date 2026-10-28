import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export { isArRpcUser, formatSocketName } from './rpcProtocol.js';

/**
 * Get the standard default Unix socket path for Discord on Linux.
 * Typically /run/user/<uid>/discord-ipc-0.
 *
 * @returns {string} Absolute path to standard default socket
 */
export function getDefaultSocketPath() {
    const xdgRuntime = GLib.getenv('XDG_RUNTIME_DIR') ||
        (typeof GLib.get_user_runtime_dir === 'function' ? GLib.get_user_runtime_dir() : '');
    if (xdgRuntime) {
        return `${xdgRuntime}/discord-ipc-0`;
    }
    return '/run/user/1000/discord-ipc-0';
}

/**
 * Test whether a Unix domain socket path is actively listening and accepting connections.
 * Uses a non-blocking Gio.Socket to prevent blocking or hanging the main loop.
 *
 * @param {string} socketPath
 * @returns {boolean} True if the socket is actively listening
 */
export function isSocketLive(socketPath) {
    if (!socketPath) return false;
    try {
        const file = Gio.File.new_for_path(socketPath);
        if (!file.query_exists(null)) {
            return false;
        }
        const sock = new Gio.Socket({
            family: Gio.SocketFamily.UNIX,
            type: Gio.SocketType.STREAM,
            protocol: Gio.SocketProtocol.DEFAULT,
        });
        sock.init(null);
        sock.set_blocking(false);
        const address = Gio.UnixSocketAddress.new(socketPath);
        sock.connect(address, null);
        sock.close();
        return true;
    } catch (_) {
        return false;
    }
}
