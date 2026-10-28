/**
 * Discord IPC Protocol Constants and Framing
 *
 * Implements Discord IPC frame encoding and decoding according to the Discord RPC protocol:
 * - 8-byte header:
 *   - bytes 0-3: Opcode (32-bit unsigned integer, little-endian)
 *   - bytes 4-7: Length of JSON payload in bytes (32-bit unsigned integer, little-endian)
 * - payload: UTF-8 JSON string
 */

export const OP_HANDSHAKE = 0;
export const OP_FRAME = 1;
export const OP_CLOSE = 2;
export const OP_PING = 3;
export const OP_PONG = 4;

/**
 * Encodes an opcode and JSON object into a Discord IPC binary frame.
 *
 * @param {number} opcode - Discord IPC opcode (e.g. OP_HANDSHAKE, OP_FRAME)
 * @param {object} jsonObject - Object to be serialized to JSON
 * @returns {Uint8Array} Binary frame ready to be sent over the socket
 */
export function encodeFrame(opcode, jsonObject) {
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(JSON.stringify(jsonObject));
    const totalLength = 8 + payloadBytes.length;
    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    // Write header (little-endian u32)
    view.setUint32(0, opcode, true);
    view.setUint32(4, payloadBytes.length, true);

    // Write payload
    const uint8 = new Uint8Array(arrayBuffer);
    uint8.set(payloadBytes, 8);

    return uint8;
}

/**
 * FrameDecoder accumulates chunks from a stream and yields complete frames.
 * Handles packet fragmentation, packet coalescing, and partial frames.
 */
export class FrameDecoder {
    constructor() {
        this._buffer = new Uint8Array(0);
        this._decoder = new TextDecoder('utf-8');
    }

    /**
     * Feed incoming raw bytes into decoder.
     *
     * @param {Uint8Array|ArrayBuffer|Array} chunk - Incoming bytes
     * @returns {Array<{opcode: number, data: object}>} List of decoded frames
     */
    feed(chunk) {
        if (!chunk || chunk.length === 0) {
            return [];
        }

        const chunkArray = (chunk instanceof Uint8Array)
            ? chunk
            : new Uint8Array(chunk.buffer || chunk);

        // Concatenate existing buffer with new chunk
        const nextBuffer = new Uint8Array(this._buffer.length + chunkArray.length);
        nextBuffer.set(this._buffer, 0);
        nextBuffer.set(chunkArray, this._buffer.length);
        this._buffer = nextBuffer;

        const frames = [];

        while (this._buffer.length >= 8) {
            const view = new DataView(
                this._buffer.buffer,
                this._buffer.byteOffset,
                this._buffer.byteLength
            );

            const opcode = view.getUint32(0, true);
            const length = view.getUint32(4, true);

            // Sanity check: prevent memory exhaustion if corrupted stream reports an absurd length
            if (length > 16 * 1024 * 1024) {
                console.error(`[DiscordVoice][rpcProtocol] Excessive frame length (${length} bytes), resetting buffer`);
                this.reset();
                break;
            }

            if (this._buffer.length < 8 + length) {
                // Not enough bytes yet for full payload
                break;
            }

            const payloadBytes = this._buffer.subarray(8, 8 + length);
            try {
                const jsonStr = this._decoder.decode(payloadBytes);
                const data = JSON.parse(jsonStr);
                frames.push({ opcode, data });
            } catch (err) {
                console.error(`[DiscordVoice][rpcProtocol] Failed to parse frame JSON: ${err}`);
            }

            // Slice remaining buffer
            this._buffer = this._buffer.subarray(8 + length);
        }

        return frames;
    }

    /**
     * Clears internal buffer.
     */
    reset() {
        this._buffer = new Uint8Array(0);
    }
}

/**
 * Checks if a Discord user profile matches the mock/stub profile sent by arRPC.
 * arRPC is a lightweight Rich Presence bridge that does NOT support Discord Voice RPC.
 *
 * @param {object|null} user - Discord user object from READY event
 * @returns {boolean} True if the user is identified as arRPC
 */
export function isArRpcUser(user) {
    if (!user) return false;
    const username = String(user.username || '').trim().toLowerCase();
    const globalName = String(user.global_name || '').trim().toLowerCase();
    const id = String(user.id || '').trim();

    if (username === 'arrpc' || globalName === 'arrpc') return true;
    if (username.includes('arrpc') || globalName.includes('arrpc')) return true;
    if (id === '0' && user.discriminator === '0000') return true;

    return false;
}

/**
 * Formats a raw socket path into a clean, human-readable label.
 *
 * @param {string} socketPath - Absolute path to Unix domain socket
 * @returns {string} Human-friendly label (e.g. "discord-ipc-0 (Official Discord / Host)")
 */
export function formatSocketName(socketPath) {
    if (!socketPath) return 'None';

    const filename = socketPath.split('/').pop() || socketPath;

    if (socketPath.includes('dev.vencord.Vesktop')) {
        return `${filename} (Vesktop / arRPC)`;
    }
    if (socketPath.includes('com.discordapp.DiscordCanary')) {
        return `${filename} (Flatpak Discord Canary)`;
    }
    if (socketPath.includes('com.discordapp.DiscordPTB')) {
        return `${filename} (Flatpak Discord PTB)`;
    }
    if (socketPath.includes('com.discordapp.DiscordDevelopment')) {
        return `${filename} (Flatpak Discord Dev)`;
    }
    if (socketPath.includes('com.discordapp.Discord')) {
        return `${filename} (Flatpak Discord)`;
    }
    if (socketPath.includes('snap.discord')) {
        return `${filename} (Snap Discord)`;
    }
    if (socketPath.includes('io.github.spacingbat3.webcord')) {
        return `${filename} (WebCord)`;
    }
    if (socketPath.includes('xyz.armcord.ArmCord')) {
        return `${filename} (ArmCord)`;
    }
    if (socketPath.startsWith('/tmp')) {
        return `${filename} (/tmp)`;
    }

    // Standard host runtime directory
    return `${filename} (Standard / Host)`;
}
