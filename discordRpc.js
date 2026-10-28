import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { OP_HANDSHAKE, OP_FRAME, OP_CLOSE, OP_PING, OP_PONG, encodeFrame, FrameDecoder } from './rpcProtocol.js';
import { getDefaultSocketPath, isArRpcUser, formatSocketName } from './socketUtils.js';

/**
 * Discord IPC Client for GNOME Shell (Manual Connection Mode)
 *
 * Communicates with a user-specified Discord Desktop client via Unix domain sockets
 * (e.g. /run/user/1000/discord-ipc-0, Flatpak Discord socket, or custom path).
 * Features an asynchronous FIFO write queue to prevent G_IO_ERROR_PENDING concurrency bugs,
 * one-click voice authorization, and explicit manual connect/disconnect control.
 */
export class DiscordRpcClient {
    /**
     * @param {Gio.Settings} settings - Extension GSettings instance
     */
    constructor(settings) {
        this._settings = settings;
        this._decoder = new FrameDecoder();
        this._listeners = new Map();
        this._pendingRequests = new Map();

        // FIFO Write Queue for Gio.OutputStream to prevent G_IO_ERROR_PENDING
        this._writeQueue = [];
        this._isWriting = false;

        this._connection = null;
        this._inputStream = null;
        this._outputStream = null;
        this._cancellable = null;
        this._handshakeTimerId = null;
        this._connectTimerId = null;
        this._activeSocketPath = null;

        this._isConnected = false;
        this._isConnecting = false;
        this._enabled = false;
        this._isArRpc = false;
        this._isLoggedOut = false;
        this._isAuthenticated = false;
        this._isAuthenticating = false;
        this._currentUser = null;
        this._currentVoiceChannel = null;
        this._currentVoiceSettings = null;
        this._speakingUsers = new Set();

        // Subscribed channel for voice state events
        this._subscribedChannelId = null;

        // Read settings (default to Discord StreamKit Voice Application ID)
        this._clientId = this._settings?.get_string('client-id') || '207646673902501888';
        if (this._clientId === '383226320970055681') {
            // Auto-migrate legacy VS Code Client ID to StreamKit Voice Client ID
            this._clientId = '207646673902501888';
            if (this._settings) {
                this._settings.set_string('client-id', '207646673902501888');
            }
        }
        this._accessToken = this._settings?.get_string('access-token') || '';
        this._manualSocketPath = this._settings?.get_string('manual-socket-path') || '';
        this._connectOnStartup = this._settings ? this._settings.get_boolean('connect-on-startup') : false;

        // Listen for settings changes
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', (s, key) => {
                if (key === 'client-id') {
                    this._clientId = s.get_string('client-id');
                    if (this._isConnected) {
                        this.reconnect();
                    }
                } else if (key === 'access-token') {
                    const newToken = s.get_string('access-token');
                    if (this._accessToken !== newToken) {
                        this._accessToken = newToken;
                        if (this._isConnected && this._accessToken && !this._isArRpc) {
                            this.authenticate(this._accessToken).then(() => {
                                this._isAuthenticated = true;
                                this._initVoiceSubscriptions();
                                this._emit('authenticated', { token: this._accessToken });
                            }).catch(e => {
                                console.warn(`[DiscordVoice] Authentication update failed: ${e.message}`);
                            });
                        }
                    }
                } else if (key === 'manual-socket-path') {
                    const newPath = s.get_string('manual-socket-path');
                    if (this._manualSocketPath !== newPath) {
                        this._manualSocketPath = newPath;
                        if (this._isConnected) {
                            this.reconnect();
                        }
                    }
                } else if (key === 'connect-on-startup') {
                    this._connectOnStartup = s.get_boolean('connect-on-startup');
                }
            });
        }
    }

    get isConnected() {
        return this._isConnected;
    }

    get isConnecting() {
        return this._isConnecting;
    }

    get isAuthenticated() {
        return this._isAuthenticated || this._isMockUser();
    }

    get isAuthenticating() {
        return this._isAuthenticating;
    }

    get isLoggedOut() {
        return this._isLoggedOut;
    }

    get isArRpc() {
        return this._isArRpc;
    }

    get activeSocketPath() {
        return this._activeSocketPath;
    }

    get manualSocketPath() {
        return this._manualSocketPath?.trim() || getDefaultSocketPath();
    }

    get currentUser() {
        return this._currentUser;
    }

    get currentVoiceChannel() {
        return this._currentVoiceChannel;
    }

    get currentVoiceSettings() {
        return this._currentVoiceSettings;
    }

    get speakingUsers() {
        return new Set(this._speakingUsers);
    }

    isUserSpeaking(userId) {
        if (!userId) return false;
        return this._speakingUsers.has(String(userId));
    }

    /**
     * Set the manual socket path in settings.
     * @param {string} socketPath - Absolute path to Unix socket
     */
    setManualSocket(socketPath) {
        const cleanPath = (socketPath || '').trim();
        if (this._settings) {
            this._settings.set_string('manual-socket-path', cleanPath);
        } else {
            this._manualSocketPath = cleanPath;
            if (this._isConnected) {
                this.reconnect();
            }
        }
    }

    /**
     * Start the RPC client.
     * If connect-on-startup is enabled, attempts connection to the configured manual socket.
     */
    start() {
        this._enabled = true;
        if (this._connectOnStartup) {
            this.connect();
        }
    }

    /**
     * Stop and disconnect the RPC client.
     */
    stop() {
        this._enabled = false;
        this.disconnect('Extension stopped');
    }

    /**
     * Clean up all resources, cancellables, timers, and listeners.
     */
    destroy() {
        this._enabled = false;
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this.disconnect('Extension destroyed');
        this._listeners.clear();
    }

    /**
     * Register an event listener.
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (this._listeners.has(event)) {
            this._listeners.get(event).delete(callback);
        }
    }

    _emit(event, ...args) {
        if (this._listeners.has(event)) {
            for (const cb of this._listeners.get(event)) {
                try {
                    cb(...args);
                } catch (e) {
                    console.error(`[DiscordVoice] Error in event listener '${event}': ${e}`);
                }
            }
        }
    }

    _clearConnectTimeout() {
        if (this._connectTimerId) {
            GLib.source_remove(this._connectTimerId);
            this._connectTimerId = null;
        }
    }

    _clearHandshakeTimeout() {
        if (this._handshakeTimerId) {
            GLib.source_remove(this._handshakeTimerId);
            this._handshakeTimerId = null;
        }
    }

    /**
     * Tear down the current socket connection without scheduling any auto-reconnection.
     */
    _disconnectSocketOnly() {
        this._clearConnectTimeout();
        this._clearHandshakeTimeout();

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        this._clearWriteQueue(new Error('Discord IPC socket disconnected'));

        for (const [nonce, req] of this._pendingRequests.entries()) {
            if (req.timeoutId) GLib.source_remove(req.timeoutId);
            req.reject(new Error('Discord IPC socket disconnected'));
        }
        this._pendingRequests.clear();

        try {
            this._inputStream?.close(null);
        } catch (_) {}
        this._inputStream = null;

        try {
            this._outputStream?.close(null);
        } catch (_) {}
        this._outputStream = null;

        try {
            this._connection?.close(null);
        } catch (_) {}
        this._connection = null;

        this._decoder.reset();
        this._isConnecting = false;
        this._speakingUsers.clear();
    }

    /**
     * Called when the manual socket connection fails.
     */
    _handleConnectionFailure(reason) {
        this._disconnectSocketOnly();
        this._isConnected = false;
        this._isConnecting = false;
        console.warn(`[DiscordVoice] Connection to ${this._activeSocketPath} failed: ${reason}`);
        this._emit('disconnected', reason);
    }

    /**
     * Start a 5-second handshake timeout to prevent hanging on unresponsive sockets.
     */
    _startHandshakeTimeout() {
        this._clearHandshakeTimeout();
        this._handshakeTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._handshakeTimerId = null;
            if (!this._isConnected && this._enabled) {
                this._handleConnectionFailure(`Handshake timed out waiting for READY on ${this._activeSocketPath}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Manually connect to Discord via the configured or provided Unix domain socket.
     * @param {string} [customSocketPath] - Optional socket path overriding settings
     */
    connect(customSocketPath = null) {
        if (this._isConnected) {
            this.disconnect('Reconnecting with new parameters');
        }

        this._enabled = true;
        const targetPath = (customSocketPath || this._manualSocketPath || getDefaultSocketPath()).trim();

        if (!targetPath) {
            const err = 'No Discord socket path configured';
            console.warn(`[DiscordVoice] ${err}`);
            this._emit('disconnected', err);
            return;
        }

        const file = Gio.File.new_for_path(targetPath);
        if (!file.query_exists(null)) {
            const err = `Socket file not found: ${targetPath}`;
            console.warn(`[DiscordVoice] ${err}`);
            this._activeSocketPath = targetPath;
            this._emit('disconnected', err);
            return;
        }

        this._activeSocketPath = targetPath;
        this._isConnecting = true;
        this._emit('connecting', targetPath);
        this._connectToSocket(targetPath);
    }

    /**
     * Establish asynchronous Unix socket connection to the target socket path.
     */
    _connectToSocket(socketPath) {
        this._cancellable = new Gio.Cancellable();
        this._clearConnectTimeout();

        // 5-second asynchronous connection timeout guard
        this._connectTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._connectTimerId = null;
            if (this._isConnecting && !this._isConnected) {
                this._cancellable?.cancel();
                this._handleConnectionFailure(`Socket connect timed out after 5s on ${socketPath}`);
            }
            return GLib.SOURCE_REMOVE;
        });

        const client = new Gio.SocketClient();
        // NOTE: Do NOT call client.set_timeout() here. Gio.SocketClient.set_timeout()
        // sets the timeout on the created GSocket for its entire lifetime. That causes
        // the asynchronous stream read loop (read_bytes_async) to abort with G_IO_ERROR_TIMED_OUT
        // ("Socket I/O timed out") whenever Discord is idle and not transmitting voice events.

        try {
            const address = Gio.UnixSocketAddress.new(socketPath);
            client.connect_async(address, this._cancellable, (source, res) => {
                this._clearConnectTimeout();
                try {
                    this._connection = source.connect_finish(res);

                    // Explicitly ensure socket has no I/O timeout for persistent streaming
                    try {
                        const socket = this._connection.get_socket();
                        if (socket) {
                            socket.set_timeout(0);
                        }
                    } catch (_) {}

                    this._inputStream = this._connection.get_input_stream();
                    this._outputStream = this._connection.get_output_stream();
                    this._decoder.reset();

                    // Start 5-second handshake timeout waiting for READY event
                    this._startHandshakeTimeout();

                    // Send Handshake (Opcode 0)
                    this._sendHandshake();

                    // Start continuous async read loop
                    this._readLoop();
                } catch (err) {
                    if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }
                    this._handleConnectionFailure(`Socket connect error: ${err.message}`);
                }
            });
        } catch (err) {
            this._clearConnectTimeout();
            this._handleConnectionFailure(`Socket initialization error: ${err.message}`);
        }
    }

    /**
     * Enqueue a write operation in FIFO order.
     * Prevents G_IO_ERROR_PENDING when multiple RPC commands/subscriptions are issued concurrently.
     *
     * @param {GLib.Bytes} glibBytes
     * @returns {Promise<void>}
     */
    _queueWrite(glibBytes) {
        return new Promise((resolve, reject) => {
            if (!this._outputStream || this._cancellable?.is_cancelled()) {
                reject(new Error('Discord IPC output stream not available'));
                return;
            }

            this._writeQueue.push({ glibBytes, resolve, reject });
            this._processWriteQueue();
        });
    }

    _processWriteQueue() {
        if (this._isWriting || this._writeQueue.length === 0) return;
        if (!this._outputStream || this._cancellable?.is_cancelled()) {
            this._clearWriteQueue(new Error('Discord IPC connection closed'));
            return;
        }

        this._isWriting = true;
        const { glibBytes, resolve, reject } = this._writeQueue.shift();

        this._outputStream.write_bytes_async(
            glibBytes,
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (stream, res) => {
                try {
                    stream.write_bytes_finish(res);
                    resolve();
                } catch (err) {
                    reject(err);
                } finally {
                    this._isWriting = false;
                    this._processWriteQueue();
                }
            }
        );
    }

    _clearWriteQueue(error) {
        for (const item of this._writeQueue) {
            item.reject(error);
        }
        this._writeQueue = [];
        this._isWriting = false;
    }

    /**
     * Send initial Discord IPC handshake frame.
     */
    _sendHandshake() {
        const payload = {
            v: 1,
            client_id: this._clientId,
        };

        const frame = encodeFrame(OP_HANDSHAKE, payload);
        const glibBytes = new GLib.Bytes(frame);

        this._queueWrite(glibBytes).catch(err => {
            if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                return;
            }
            if (!this._isConnected) {
                this._handleConnectionFailure(`Handshake write failed: ${err.message}`);
            } else if (this._enabled && this._cancellable && !this._cancellable.is_cancelled()) {
                this._handleDisconnect(`Failed to send handshake: ${err.message}`);
            }
        });
    }

    /**
     * Continuous asynchronous read loop.
     */
    _readLoop() {
        if (!this._inputStream || !this._enabled || this._cancellable?.is_cancelled()) return;

        this._inputStream.read_bytes_async(
            4096,
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (stream, res) => {
                try {
                    const bytes = stream.read_bytes_finish(res);
                    if (!bytes || bytes.get_size() === 0) {
                        if (!this._isConnected) {
                            this._handleConnectionFailure('Socket closed before READY (EOF)');
                        } else {
                            this._handleDisconnect('Remote Discord client closed IPC socket (EOF)');
                        }
                        return;
                    }

                    const uint8 = bytes.get_data();
                    const frames = this._decoder.feed(uint8);

                    for (const frame of frames) {
                        this._handleFrame(frame);
                    }

                    // Continue reading next chunk
                    if (this._enabled && !this._cancellable?.is_cancelled()) {
                        this._readLoop();
                    }
                } catch (err) {
                    if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }
                    if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.TIMED_OUT)) {
                        // In case of an idle read timeout, do not drop the persistent connection;
                        // reset the socket timeout to 0 and continue the read loop.
                        try {
                            this._connection?.get_socket()?.set_timeout(0);
                        } catch (_) {}
                        if (this._enabled && !this._cancellable?.is_cancelled()) {
                            this._readLoop();
                        }
                        return;
                    }
                    if (!this._isConnected) {
                        this._handleConnectionFailure(`Stream read error: ${err.message}`);
                    } else if (this._enabled && this._cancellable && !this._cancellable.is_cancelled()) {
                        this._handleDisconnect(`Stream read error: ${err.message}`);
                    }
                }
            }
        );
    }

    /**
     * Process received Discord IPC frame.
     * @param {{ opcode: number, data: object }} frame
     */
    _handleFrame(frame) {
        const { opcode, data } = frame;

        if (opcode === OP_PING) {
            const pongFrame = encodeFrame(OP_PONG, data || {});
            this._queueWrite(new GLib.Bytes(pongFrame)).catch(() => {});
            return;
        }

        if (opcode === OP_CLOSE) {
            const code = data?.code;
            const reason = data?.message || 'Discord IPC closed';
            const isLoggedOut = (code === 1000 || String(reason).toLowerCase().includes('logged out'));
            const isInvalidClientId = (code === 4000 || String(reason).toLowerCase().includes('invalid client id'));

            // If Discord rejected the client-id, fallback automatically to official client ID
            if (isInvalidClientId && this._clientId !== '207646673902501888') {
                console.warn(`[DiscordVoice] Client ID '${this._clientId}' rejected. Retrying with default client ID...`);
                this._clientId = '207646673902501888';
                if (this._settings) {
                    this._settings.set_string('client-id', '207646673902501888');
                }
                this._disconnectSocketOnly();
                this._connectToSocket(this._activeSocketPath);
                return;
            }

            if (isLoggedOut) {
                console.log(`[DiscordVoice] Connected to Discord socket (${this._activeSocketPath}), but no user account is logged in.`);
                this._clearHandshakeTimeout();
                this._isLoggedOut = true;
                this._emit('user-logged-out', {
                    socketPath: this._activeSocketPath,
                    message: reason,
                });
                this._disconnectSocketOnly();
                return;
            }

            if (!this._isConnected) {
                this._handleConnectionFailure(reason);
            } else {
                this._handleDisconnect(reason);
            }
            return;
        }

        if (!data) return;

        // Match pending command nonces
        if (data.nonce && this._pendingRequests.has(data.nonce)) {
            const { resolve, reject, timeoutId } = this._pendingRequests.get(data.nonce);
            if (timeoutId) GLib.source_remove(timeoutId);
            this._pendingRequests.delete(data.nonce);

            if (data.evt === 'ERROR') {
                const errMsg = data.data?.message || 'Discord RPC returned an error';
                const errCode = data.data?.code || 0;
                reject(new Error(`[${errCode}] ${errMsg}`));
                return;
            } else {
                resolve(data.data);
            }
        }

        // Handle Dispatch events
        if (data.cmd === 'DISPATCH') {
            this._handleDispatchEvent(data.evt, data.data);
        }
    }

    /**
     * Handle incoming DISPATCH events.
     */
    _handleDispatchEvent(evt, eventData) {
        switch (evt) {
            case 'READY': {
                this._clearHandshakeTimeout();
                this._isLoggedOut = false;
                this._isConnecting = false;
                this._currentUser = eventData?.user || null;
                const isArRpc = isArRpcUser(this._currentUser);
                this._isArRpc = isArRpc;

                this._isConnected = true;
                const displayName = this._currentUser?.global_name || this._currentUser?.username || 'Unknown';
                console.log(`[DiscordVoice] Connected to Discord IPC (${this._activeSocketPath}) as ${displayName}${isArRpc ? ' (arRPC stub)' : ''}`);

                this._emit('connected', {
                    user: this._currentUser,
                    isArRpc: this._isArRpc,
                    socketPath: this._activeSocketPath,
                });

                if (this._isArRpc) {
                    console.warn('[DiscordVoice] Connected to arRPC: Voice RPC is not supported by arRPC.');
                    this._emit('arrpc-detected', {
                        user: this._currentUser,
                        socketPath: this._activeSocketPath,
                    });
                    return;
                }

                // If connecting to mock server, mark authenticated and initialize immediately
                if (this._isMockUser()) {
                    this._isAuthenticated = true;
                    this._initVoiceSubscriptions();
                    return;
                }

                // Official Discord client: Attempt authentication or request user authorization
                this._handleOfficialClientAuth();
                break;
            }

            case 'VOICE_CHANNEL_SELECT': {
                const channelId = eventData?.channel_id;
                if (!channelId) {
                    this._cleanupChannelSubscriptions();
                    this._currentVoiceChannel = null;
                    this._emit('voice-channel-changed', null);
                } else {
                    this._updateChannelSubscriptions(channelId);
                    this.getSelectedVoiceChannel().catch(() => {});
                }
                break;
            }

            case 'VOICE_STATE_CREATE':
            case 'VOICE_STATE_UPDATE':
            case 'VOICE_STATE_DELETE': {
                this._handleVoiceStateEvent(evt, eventData);
                break;
            }

            case 'VOICE_SETTINGS_UPDATE': {
                this._currentVoiceSettings = eventData;
                this._emit('voice-settings-changed', eventData);
                break;
            }

            case 'SPEAKING_START':
            case 'SPEAKING_STOP':
            case 'SPEAKING': {
                const userId = String(eventData?.user_id || eventData?.userId || eventData?.id || '');
                let speaking = false;
                if (evt === 'SPEAKING_START') {
                    speaking = true;
                } else if (evt === 'SPEAKING_STOP') {
                    speaking = false;
                } else {
                    speaking = Boolean(eventData?.speaking);
                }

                if (userId) {
                    if (speaking) {
                        this._speakingUsers.add(userId);
                    } else {
                        this._speakingUsers.delete(userId);
                    }
                    this._emit('speaking-changed', {
                        userId,
                        speaking,
                        channelId: eventData?.channel_id || this._subscribedChannelId,
                    });
                }
                break;
            }

            default:
                break;
        }
    }

    /**
     * Handle real-time voice state events (joined, updated, left).
     * Maintains currentVoiceChannel.voice_states accurately.
     */
    _handleVoiceStateEvent(evt, eventData) {
        if (!eventData) return;

        const rawUser = eventData.user || {};
        const userId = String(rawUser.id || eventData.user_id || eventData.id || '');
        if (!userId) {
            this.getSelectedVoiceChannel().catch(() => {});
            return;
        }

        // If the current user left/was deleted, clean up channel
        const currentUserId = String(this._currentUser?.id || '');
        if (evt === 'VOICE_STATE_DELETE' && currentUserId && userId === currentUserId) {
            this._cleanupChannelSubscriptions();
            this._currentVoiceChannel = null;
            this._emit('voice-channel-changed', null);
            return;
        }

        if (!this._currentVoiceChannel) {
            const channelId = eventData.channel_id || this._subscribedChannelId;
            if (channelId) {
                this._currentVoiceChannel = {
                    id: channelId,
                    name: 'Voice Channel',
                    voice_states: [],
                };
            } else {
                return;
            }
        }

        if (!Array.isArray(this._currentVoiceChannel.voice_states)) {
            this._currentVoiceChannel.voice_states = [];
        }

        const voiceStates = this._currentVoiceChannel.voice_states;
        const existingIdx = voiceStates.findIndex(m => {
            const mId = String(m?.user?.id || m?.user_id || m?.id || '');
            return mId === userId;
        });

        if (evt === 'VOICE_STATE_DELETE') {
            if (existingIdx !== -1) {
                voiceStates.splice(existingIdx, 1);
            }
            this._speakingUsers.delete(userId);
        } else {
            // VOICE_STATE_CREATE or VOICE_STATE_UPDATE
            const isMuted = Boolean(
                eventData.voice_state?.mute ||
                eventData.voice_state?.self_mute ||
                eventData.mute ||
                eventData.self_mute
            );
            const isDeaf = Boolean(
                eventData.voice_state?.deaf ||
                eventData.voice_state?.self_deaf ||
                eventData.deaf ||
                eventData.self_deaf
            );

            const normalizedMember = {
                user: {
                    id: userId,
                    username: rawUser.username || eventData.nick || 'User',
                    discriminator: rawUser.discriminator || '0',
                    global_name: rawUser.global_name || rawUser.username || eventData.nick || null,
                    avatar: rawUser.avatar || null,
                    bot: Boolean(rawUser.bot),
                },
                nick: eventData.nick || rawUser.global_name || null,
                volume: typeof eventData.volume === 'number' ? eventData.volume : 100,
                mute: isMuted,
                deaf: isDeaf,
                voice_state: {
                    mute: Boolean(eventData.voice_state?.mute ?? eventData.mute),
                    deaf: Boolean(eventData.voice_state?.deaf ?? eventData.deaf),
                    self_mute: Boolean(eventData.voice_state?.self_mute ?? eventData.self_mute),
                    self_deaf: Boolean(eventData.voice_state?.self_deaf ?? eventData.self_deaf),
                    suppress: Boolean(eventData.voice_state?.suppress ?? eventData.suppress),
                },
            };

            if (existingIdx !== -1) {
                voiceStates[existingIdx] = {
                    ...voiceStates[existingIdx],
                    ...normalizedMember,
                    user: {
                        ...voiceStates[existingIdx].user,
                        ...normalizedMember.user,
                    },
                    voice_state: {
                        ...voiceStates[existingIdx].voice_state,
                        ...normalizedMember.voice_state,
                    },
                };
            } else {
                voiceStates.push(normalizedMember);
            }
        }

        this._emit('voice-state-changed', eventData);
        this._emit('voice-channel-changed', this._currentVoiceChannel);
    }

    /**
     * Update subscriptions when switching voice channels.
     */
    _updateChannelSubscriptions(newChannelId) {
        if (this._subscribedChannelId && this._subscribedChannelId !== newChannelId) {
            this._cleanupChannelSubscriptions();
        }

        if (newChannelId && this._subscribedChannelId !== newChannelId) {
            this._subscribedChannelId = newChannelId;
            const args = { channel_id: newChannelId };
            this.subscribe('VOICE_STATE_CREATE', args).catch(() => {});
            this.subscribe('VOICE_STATE_UPDATE', args).catch(() => {});
            this.subscribe('VOICE_STATE_DELETE', args).catch(() => {});
            this.subscribe('SPEAKING_START', args).catch(() => {});
            this.subscribe('SPEAKING_STOP', args).catch(() => {});
            this.subscribe('SPEAKING', args).catch(() => {});
        }
    }

    _cleanupChannelSubscriptions() {
        if (this._subscribedChannelId) {
            const args = { channel_id: this._subscribedChannelId };
            this.unsubscribe('VOICE_STATE_CREATE', args).catch(() => {});
            this.unsubscribe('VOICE_STATE_UPDATE', args).catch(() => {});
            this.unsubscribe('VOICE_STATE_DELETE', args).catch(() => {});
            this.unsubscribe('SPEAKING_START', args).catch(() => {});
            this.unsubscribe('SPEAKING_STOP', args).catch(() => {});
            this.unsubscribe('SPEAKING', args).catch(() => {});
            this._subscribedChannelId = null;
            this._speakingUsers.clear();
        }
    }

    /**
     * Send a command with nonce resolution.
     *
     * @param {string} cmd - RPC Command name (e.g. GET_SELECTED_VOICE_CHANNEL)
     * @param {object} args - Command arguments
     * @param {string|null} evt - Optional event name (e.g. for SUBSCRIBE)
     * @param {number} [timeoutSec=6] - Timeout in seconds (AUTHORIZE defaults to 120s)
     * @returns {Promise<any>}
     */
    sendCommand(cmd, args = {}, evt = null, timeoutSec = 6) {
        if (!this._isConnected || !this._outputStream || this._cancellable?.is_cancelled()) {
            return Promise.reject(new Error('Discord IPC client is not connected'));
        }

        if (this._isArRpc) {
            return Promise.reject(new Error('Commands not supported on arRPC'));
        }

        const nonce = GLib.uuid_string_random();
        const payload = { cmd, args, nonce };
        if (evt) payload.evt = evt;

        const effectiveTimeout = (cmd === 'AUTHORIZE') ? Math.max(timeoutSec, 120) : timeoutSec;

        return new Promise((resolve, reject) => {
            const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, effectiveTimeout, () => {
                if (this._pendingRequests.has(nonce)) {
                    this._pendingRequests.delete(nonce);
                    reject(new Error(`RPC command '${cmd}' timed out after ${effectiveTimeout}s`));
                }
                return GLib.SOURCE_REMOVE;
            });

            this._pendingRequests.set(nonce, { resolve, reject, timeoutId });

            const frame = encodeFrame(OP_FRAME, payload);
            const glibBytes = new GLib.Bytes(frame);

            this._queueWrite(glibBytes).catch(err => {
                if (this._pendingRequests.has(nonce)) {
                    GLib.source_remove(timeoutId);
                    this._pendingRequests.delete(nonce);
                }
                reject(err);
            });
        });
    }

    subscribe(evt, args = {}) {
        return this.sendCommand('SUBSCRIBE', args, evt);
    }

    unsubscribe(evt, args = {}) {
        return this.sendCommand('UNSUBSCRIBE', args, evt);
    }

    _isMockUser() {
        if (!this._currentUser) return false;
        const id = String(this._currentUser.id || '');
        const username = String(this._currentUser.username || '').toLowerCase();
        return id === '987654321012345678' || username === 'faketester';
    }

    _initVoiceSubscriptions() {
        if (!this.isAuthenticated) return;

        this.subscribe('VOICE_CHANNEL_SELECT').catch(err => {
            console.warn(`[DiscordVoice] VOICE_CHANNEL_SELECT subscription failed: ${err.message}`);
        });
        this.subscribe('VOICE_SETTINGS_UPDATE').catch(err => {
            console.warn(`[DiscordVoice] VOICE_SETTINGS_UPDATE subscription failed: ${err.message}`);
        });

        this.getSelectedVoiceChannel().catch(() => {});
        this.getVoiceSettings().catch(() => {});
    }

    async _handleOfficialClientAuth() {
        if (this._accessToken) {
            try {
                console.log('[DiscordVoice] Authenticating with stored access token...');
                const authResult = await this.authenticate(this._accessToken);
                console.log('[DiscordVoice] Successfully authenticated with stored access token!');
                this._isAuthenticated = true;
                this._emit('authenticated', authResult);
                this._initVoiceSubscriptions();
                return;
            } catch (err) {
                console.warn(`[DiscordVoice] Stored access token was rejected: ${err.message}. Clearing token...`);
                this._accessToken = '';
                this._isAuthenticated = false;
                if (this._settings) {
                    this._settings.set_string('access-token', '');
                }
            }
        }

        console.log('[DiscordVoice] No valid access token. User authorization required.');
        this._isAuthenticated = false;
        this._emit('auth-required', {
            user: this._currentUser,
            socketPath: this._activeSocketPath,
        });
    }

    async _exchangeCodeForToken(code) {
        if (!code) throw new Error('Authorization code is missing');

        const payloadStr = JSON.stringify({ code });

        if (typeof globalThis.fetch === 'function') {
            try {
                const response = await globalThis.fetch('https://streamkit.discord.com/overlay/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: payloadStr,
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data?.access_token) return data.access_token;
                }
            } catch (err) {
                console.warn(`[DiscordVoice] fetch token exchange failed: ${err.message}`);
            }
        }

        if (Soup) {
            try {
                const session = new Soup.Session();
                const msg = Soup.Message.new('POST', 'https://streamkit.discord.com/overlay/token');
                const bodyBytes = new GLib.Bytes(new TextEncoder().encode(payloadStr));
                msg.set_request_body_from_bytes('application/json', bodyBytes);
                msg.get_request_headers().append('Accept', 'application/json');

                const resBytes = await new Promise((resolve, reject) => {
                    session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                        try {
                            resolve(s.send_and_read_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                const status = msg.get_status ? msg.get_status() : msg.status_code;
                if (status === 200 && resBytes && resBytes.get_size() > 0) {
                    const dataBytes = resBytes.toArray ? resBytes.toArray() : (resBytes.get_data ? resBytes.get_data() : resBytes);
                    const resText = new TextDecoder('utf-8').decode(dataBytes);
                    const data = JSON.parse(resText);
                    if (data?.access_token) {
                        return data.access_token;
                    }
                }
            } catch (soupErr) {
                console.warn(`[DiscordVoice] Soup token exchange failed: ${soupErr.message}`);
            }
        }

        try {
            const proc = new Gio.Subprocess({
                argv: [
                    'curl', '-s', '-S', '-X', 'POST',
                    'https://streamkit.discord.com/overlay/token',
                    '-H', 'Content-Type: application/json',
                    '-H', 'Accept: application/json',
                    '-d', payloadStr,
                ],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);

            const [stdout, stderr] = await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out, err] = p.communicate_utf8_finish(res);
                        resolve([out, err]);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (stdout) {
                const data = JSON.parse(stdout);
                if (data?.access_token) {
                    return data.access_token;
                }
            }
            if (stderr) {
                console.warn(`[DiscordVoice] curl token exchange error: ${stderr}`);
            }
        } catch (procErr) {
            console.error(`[DiscordVoice] Gio.Subprocess token exchange error: ${procErr.message}`);
        }

        throw new Error('Failed to exchange authorization code for Discord access token');
    }

    /**
     * Authorize application with Discord via OAuth2 prompt.
     */
    async authorize({ prompt = 'consent' } = {}) {
        if (!this._isConnected) {
            throw new Error('Discord IPC is not connected');
        }

        if (this._isAuthenticating) {
            console.log('[DiscordVoice] Authorization already in progress');
            return null;
        }

        this._isAuthenticating = true;
        try {
            if (this._isMockUser()) {
                this._accessToken = 'mock_token_123';
                if (this._settings) {
                    this._settings.set_string('access-token', this._accessToken);
                }
                this._isAuthenticated = true;
                this._emit('authenticated', { user: this._currentUser, token: this._accessToken });
                this._initVoiceSubscriptions();
                return { user: this._currentUser, token: this._accessToken };
            }

            console.log(`[DiscordVoice] Requesting AUTHORIZE from Discord (client_id: ${this._clientId}${prompt ? `, prompt: ${prompt}` : ''})...`);
            const authArgs = {
                client_id: this._clientId,
                scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
            };
            if (prompt) {
                authArgs.prompt = prompt;
            }
            const authData = await this.sendCommand('AUTHORIZE', authArgs, null, 120);

            const code = authData?.code;
            if (!code) {
                throw new Error('Discord did not return an authorization code');
            }

            console.log('[DiscordVoice] Received authorization code. Exchanging token with StreamKit...');
            const token = await this._exchangeCodeForToken(code);
            if (!token) {
                throw new Error('StreamKit token exchange did not return an access token');
            }

            this._accessToken = token;
            if (this._settings) {
                this._settings.set_string('access-token', token);
            }

            console.log('[DiscordVoice] Authenticating RPC session with token...');
            const result = await this.authenticate(token);
            this._isAuthenticated = true;
            this._emit('authenticated', result);
            this._initVoiceSubscriptions();
            return result;
        } finally {
            this._isAuthenticating = false;
        }
    }

    /**
     * Authenticate via OAuth2 token.
     */
    async authenticate(accessToken) {
        if (!accessToken) {
            throw new Error('No access token provided');
        }
        const data = await this.sendCommand('AUTHENTICATE', { access_token: accessToken });
        this._isAuthenticated = true;
        return data;
    }

    /**
     * Fetch current selected voice channel and participants.
     */
    async getSelectedVoiceChannel() {
        if (this._isArRpc || !this.isAuthenticated) {
            this._currentVoiceChannel = null;
            return null;
        }

        try {
            const data = await this.sendCommand('GET_SELECTED_VOICE_CHANNEL');
            if (data && data.id) {
                // If we already have members collected dynamically, merge them so we don't lose participants
                if (this._currentVoiceChannel && this._currentVoiceChannel.id === data.id) {
                    const existingStates = this._currentVoiceChannel.voice_states || [];
                    const newStates = data.voice_states || [];
                    const mergedMap = new Map();
                    for (const m of newStates) {
                        const uid = String(m?.user?.id || m?.user_id || m?.id || '');
                        if (uid) mergedMap.set(uid, m);
                    }
                    for (const m of existingStates) {
                        const uid = String(m?.user?.id || m?.user_id || m?.id || '');
                        if (uid && !mergedMap.has(uid)) {
                            mergedMap.set(uid, m);
                        }
                    }
                    data.voice_states = Array.from(mergedMap.values());
                }
                this._currentVoiceChannel = data;
                this._updateChannelSubscriptions(this._currentVoiceChannel.id);
            } else {
                this._currentVoiceChannel = null;
                this._cleanupChannelSubscriptions();
            }
            this._emit('voice-channel-changed', this._currentVoiceChannel);
            return this._currentVoiceChannel;
        } catch (err) {
            console.warn(`[DiscordVoice] getSelectedVoiceChannel error: ${err.message}`);
            this._currentVoiceChannel = null;
            this._cleanupChannelSubscriptions();
            this._emit('voice-channel-changed', null);
            return null;
        }
    }

    /**
     * Fetch local voice settings (mute/deaf).
     */
    async getVoiceSettings() {
        if (this._isArRpc || !this.isAuthenticated) {
            return null;
        }

        try {
            const data = await this.sendCommand('GET_VOICE_SETTINGS');
            this._currentVoiceSettings = data;
            this._emit('voice-settings-changed', data);
            return data;
        } catch (err) {
            return null;
        }
    }

    /**
     * Set local voice settings (mute / deafen).
     * @param {{ mute?: boolean, deaf?: boolean }} settings
     */
    setVoiceSettings(settings) {
        if (this._isArRpc) {
            return Promise.reject(new Error('Voice settings cannot be altered on arRPC'));
        }
        if (!this.isAuthenticated) {
            return Promise.reject(new Error('Voice settings require Discord authorization'));
        }
        return this.sendCommand('SET_VOICE_SETTINGS', settings);
    }

    /**
     * Get voice settings for a specific user in channel.
     * @param {string} userId
     */
    async getUserVoiceSettings(userId) {
        if (this._isArRpc || !this.isAuthenticated || !userId) return null;
        try {
            return await this.sendCommand('GET_USER_VOICE_SETTINGS', { user_id: String(userId) });
        } catch (err) {
            console.warn(`[DiscordVoice] GET_USER_VOICE_SETTINGS error: ${err.message}`);
            return null;
        }
    }

    /**
     * Set volume and/or mute state for a specific participant.
     * @param {string} userId
     * @param {{ volume?: number, mute?: boolean }} settings
     */
    setUserVoiceSettings(userId, settings = {}) {
        if (this._isArRpc) {
            return Promise.reject(new Error('User voice settings cannot be altered on arRPC'));
        }
        if (!this.isAuthenticated) {
            return Promise.reject(new Error('User voice settings require Discord authorization'));
        }
        const args = { user_id: String(userId), ...settings };
        return this.sendCommand('SET_USER_VOICE_SETTINGS', args);
    }

    /**
     * Get list of channels for a guild (server).
     * @param {string} guildId
     * @returns {Promise<Array<object>>}
     */
    async getChannels(guildId) {
        if (!guildId || this._isArRpc || !this.isAuthenticated) return [];
        try {
            const res = await this.sendCommand('GET_CHANNELS', { guild_id: String(guildId) });
            return res?.channels || (Array.isArray(res) ? res : []);
        } catch (err) {
            console.warn(`[DiscordVoice] GET_CHANNELS error: ${err.message}`);
            return [];
        }
    }

    /**
     * Select or switch to a voice channel.
     * @param {string|null} channelId
     * @param {boolean} [force=true]
     */
    selectVoiceChannel(channelId, force = true) {
        if (this._isArRpc || !this.isAuthenticated) {
            return Promise.reject(new Error('Channel selection not available without authorization'));
        }
        return this.sendCommand('SELECT_VOICE_CHANNEL', {
            channel_id: channelId ? String(channelId) : null,
            force,
        });
    }

    /**
     * Clean up socket connection and streams.
     * Purely manual disconnection - does not schedule any auto-reconnection.
     */
    disconnect(reason = 'Disconnected') {
        const wasConnected = this._isConnected;
        this._clearConnectTimeout();
        this._clearHandshakeTimeout();
        this._isConnected = false;
        this._isConnecting = false;
        this._isAuthenticated = false;
        this._isAuthenticating = false;
        this._isLoggedOut = false;
        this._isArRpc = false;
        this._currentUser = null;
        this._currentVoiceChannel = null;
        this._subscribedChannelId = null;
        this._speakingUsers.clear();

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        // Flush write queue
        this._clearWriteQueue(new Error('Connection disconnected'));

        // Reject all pending requests
        for (const [nonce, req] of this._pendingRequests.entries()) {
            if (req.timeoutId) GLib.source_remove(req.timeoutId);
            req.reject(new Error('Connection disconnected'));
        }
        this._pendingRequests.clear();

        try {
            this._inputStream?.close(null);
        } catch (_) {}
        this._inputStream = null;

        try {
            this._outputStream?.close(null);
        } catch (_) {}
        this._outputStream = null;

        try {
            this._connection?.close(null);
        } catch (_) {}
        this._connection = null;

        this._decoder.reset();

        if (wasConnected) {
            console.log(`[DiscordVoice] Disconnected: ${reason}`);
        }
        this._emit('disconnected', reason);
    }

    /**
     * Triggered on connection drop or socket error.
     */
    _handleDisconnect(reason) {
        this.disconnect(reason);
    }

    /**
     * Manually trigger reconnection to the current manual socket.
     */
    reconnect() {
        this.disconnect('Reconnecting manually');
        this.connect();
    }
}
