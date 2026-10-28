#!/usr/bin/env node
/**
 * Mock Discord Desktop IPC Server
 *
 * Simulates Discord Desktop's local RPC Unix domain socket (e.g. `discord-ipc-1` or `discord-ipc-0`)
 * with a full mock user session, simulated voice channel, and live voice settings controls.
 *
 * Useful for development, testing GNOME Shell extensions, and verifying RPC integrations
 * without needing an active real Discord account or login.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
    OP_HANDSHAKE,
    OP_FRAME,
    OP_CLOSE,
    OP_PING,
    OP_PONG,
    encodeFrame,
    FrameDecoder,
} from './rpcProtocol.js';

// Configuration
const SOCKET_DIR = process.env.XDG_RUNTIME_DIR || '/tmp';
const SOCKET_INDEX = process.env.MOCK_DISCORD_SOCKET_INDEX || '1';
const SOCKET_PATH = process.env.MOCK_DISCORD_SOCKET_PATH || path.join(SOCKET_DIR, `discord-ipc-${SOCKET_INDEX}`);

// Mock Account Details
export const MOCK_USER = {
    id: '987654321012345678',
    username: 'FakeTester',
    discriminator: '1337',
    global_name: 'Fake Account Tester',
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    bot: false,
    flags: 0,
    premium_type: 0,
};

// Mock Voice Channel State
export const MOCK_CHANNEL = {
    id: '998877665544332211',
    name: 'General Voice (Mock)',
    type: 2,
    guild_id: '112233445566778899',
    bitrate: 64000,
    user_limit: 10,
    voice_states: [
        {
            user: {
                id: MOCK_USER.id,
                username: MOCK_USER.username,
                global_name: MOCK_USER.global_name,
                avatar: MOCK_USER.avatar,
            },
            voice_state: {
                mute: false,
                deaf: false,
                self_mute: false,
                self_deaf: false,
                suppress: false,
            },
        },
        {
            user: {
                id: '223344556677889900',
                username: 'alice_streamer',
                global_name: 'Alice',
                avatar: 'https://cdn.discordapp.com/embed/avatars/1.png',
            },
            voice_state: {
                mute: false,
                deaf: false,
                self_mute: false,
                self_deaf: false,
                suppress: false,
            },
        },
        {
            user: {
                id: '334455667788990011',
                username: 'bob_quiet',
                global_name: 'Bob',
                avatar: 'https://cdn.discordapp.com/embed/avatars/2.png',
            },
            voice_state: {
                mute: true,
                deaf: false,
                self_mute: true,
                self_deaf: false,
                suppress: false,
            },
        },
    ],
};

let currentVoiceSettings = {
    mute: false,
    deaf: false,
    echo_cancellation: true,
    noise_suppression: true,
    automatic_gain_control: true,
    mode: { type: 'VOICE_ACTIVITY', threshold: -40 },
};

let activeVoiceChannel = JSON.parse(JSON.stringify(MOCK_CHANNEL));
const clients = new Set();

// Clean up stale socket file if it exists
try {
    if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }
} catch (_) {}

const server = net.createServer(socket => {
    clients.add(socket);
    const decoder = new FrameDecoder();
    const subscriptions = new Set();

    socket.on('data', chunk => {
        let frames;
        try {
            frames = decoder.feed(chunk);
        } catch (err) {
            console.error('[MockDiscord] Decode error:', err.message);
            return;
        }

        for (const frame of frames) {
            handleFrame(socket, frame, subscriptions);
        }
    });

    socket.on('close', () => {
        clients.delete(socket);
    });

    socket.on('error', err => {
        console.warn('[MockDiscord] Client socket error:', err.message);
        clients.delete(socket);
    });
});

function handleFrame(socket, frame, subscriptions) {
    const { opcode, data } = frame;

    // 1. Handshake (Opcode 0)
    if (opcode === OP_HANDSHAKE) {
        console.log(`[MockDiscord] Received HANDSHAKE for client_id=${data?.client_id}`);
        const readyPayload = {
            cmd: 'DISPATCH',
            evt: 'READY',
            data: {
                v: 1,
                config: {
                    cdn_host: 'cdn.discordapp.com',
                    api_endpoint: '//discord.com/api',
                    environment: 'production',
                },
                user: MOCK_USER,
            },
        };
        sendFrame(socket, OP_FRAME, readyPayload);
        return;
    }

    // 2. Ping (Opcode 3)
    if (opcode === OP_PING) {
        sendFrame(socket, OP_PONG, data || {});
        return;
    }

    // 3. Command Frame (Opcode 1)
    if (opcode === OP_FRAME && data) {
        const { cmd, args, evt, nonce } = data;

        switch (cmd) {
            case 'SUBSCRIBE': {
                if (evt) subscriptions.add(evt);
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SUBSCRIBE',
                    evt,
                    data: { evt },
                    nonce,
                });
                break;
            }

            case 'UNSUBSCRIBE': {
                if (evt) subscriptions.delete(evt);
                sendFrame(socket, OP_FRAME, {
                    cmd: 'UNSUBSCRIBE',
                    evt,
                    data: { evt },
                    nonce,
                });
                break;
            }

            case 'AUTHORIZE': {
                sendFrame(socket, OP_FRAME, {
                    cmd: 'AUTHORIZE',
                    data: {
                        code: 'mock_authorization_code_123',
                    },
                    nonce,
                });
                break;
            }

            case 'AUTHENTICATE': {
                sendFrame(socket, OP_FRAME, {
                    cmd: 'AUTHENTICATE',
                    data: {
                        user: MOCK_USER,
                        scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
                        expires: new Date(Date.now() + 86400000).toISOString(),
                    },
                    nonce,
                });
                break;
            }

            case 'GET_SELECTED_VOICE_CHANNEL': {
                sendFrame(socket, OP_FRAME, {
                    cmd: 'GET_SELECTED_VOICE_CHANNEL',
                    data: activeVoiceChannel,
                    nonce,
                });
                break;
            }

            case 'SELECT_VOICE_CHANNEL': {
                const targetChannelId = args?.channel_id;
                if (!targetChannelId) {
                    activeVoiceChannel = null;
                } else {
                    activeVoiceChannel = JSON.parse(JSON.stringify(MOCK_CHANNEL));
                }
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SELECT_VOICE_CHANNEL',
                    data: activeVoiceChannel,
                    nonce,
                });
                broadcastDispatch('VOICE_CHANNEL_SELECT', {
                    channel_id: activeVoiceChannel ? activeVoiceChannel.id : null,
                    guild_id: activeVoiceChannel ? activeVoiceChannel.guild_id : null,
                });
                break;
            }

            case 'GET_VOICE_SETTINGS': {
                sendFrame(socket, OP_FRAME, {
                    cmd: 'GET_VOICE_SETTINGS',
                    data: currentVoiceSettings,
                    nonce,
                });
                break;
            }

            case 'SET_VOICE_SETTINGS': {
                if (typeof args?.mute === 'boolean') {
                    currentVoiceSettings.mute = args.mute;
                    if (activeVoiceChannel?.voice_states) {
                        const selfState = activeVoiceChannel.voice_states.find(s => s.user.id === MOCK_USER.id);
                        if (selfState) {
                            selfState.voice_state.mute = args.mute;
                            selfState.voice_state.self_mute = args.mute;
                        }
                    }
                }
                if (typeof args?.deaf === 'boolean') {
                    currentVoiceSettings.deaf = args.deaf;
                    if (activeVoiceChannel?.voice_states) {
                        const selfState = activeVoiceChannel.voice_states.find(s => s.user.id === MOCK_USER.id);
                        if (selfState) {
                            selfState.voice_state.deaf = args.deaf;
                            selfState.voice_state.self_deaf = args.deaf;
                        }
                    }
                }
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SET_VOICE_SETTINGS',
                    data: currentVoiceSettings,
                    nonce,
                });
                broadcastDispatch('VOICE_SETTINGS_UPDATE', currentVoiceSettings);
                break;
            }

            case 'SPEAKING_START': {
                const targetUserId = String(args?.user_id || args?.userId || MOCK_USER.id);
                broadcastDispatch('SPEAKING_START', {
                    user_id: targetUserId,
                    channel_id: activeVoiceChannel?.id || MOCK_CHANNEL.id,
                });
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SPEAKING_START',
                    data: { user_id: targetUserId, speaking: true },
                    nonce,
                });
                break;
            }

            case 'SPEAKING_STOP': {
                const targetUserId = String(args?.user_id || args?.userId || MOCK_USER.id);
                broadcastDispatch('SPEAKING_STOP', {
                    user_id: targetUserId,
                    channel_id: activeVoiceChannel?.id || MOCK_CHANNEL.id,
                });
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SPEAKING_STOP',
                    data: { user_id: targetUserId, speaking: false },
                    nonce,
                });
                break;
            }

            case 'SPEAKING': {
                const targetUserId = String(args?.user_id || args?.userId || MOCK_USER.id);
                const speaking = args?.speaking !== undefined ? args.speaking : 1;
                broadcastDispatch('SPEAKING', {
                    user_id: targetUserId,
                    speaking,
                    channel_id: activeVoiceChannel?.id || MOCK_CHANNEL.id,
                });
                sendFrame(socket, OP_FRAME, {
                    cmd: 'SPEAKING',
                    data: { user_id: targetUserId, speaking },
                    nonce,
                });
                break;
            }

            default: {
                sendFrame(socket, OP_FRAME, {
                    cmd,
                    data: {},
                    nonce,
                });
                break;
            }
        }
    }
}

function sendFrame(socket, opcode, payload) {
    try {
        const encoded = encodeFrame(opcode, payload);
        socket.write(Buffer.from(encoded));
    } catch (err) {
        console.error('[MockDiscord] Send error:', err.message);
    }
}

export function broadcastDispatch(evt, data) {
    const payload = {
        cmd: 'DISPATCH',
        evt,
        data,
    };
    for (const client of clients) {
        sendFrame(client, OP_FRAME, payload);
    }
}

if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => {
        const line = String(data).trim();
        const parts = line.split(/\s+/);
        const command = parts[0]?.toLowerCase();
        const target = parts[1] || MOCK_USER.id;

        if (command === 'speak') {
            broadcastDispatch('SPEAKING_START', {
                user_id: target,
                channel_id: activeVoiceChannel?.id || MOCK_CHANNEL.id,
            });
            console.log(`[MockDiscord] Simulated SPEAKING_START for user ${target}`);
        } else if (command === 'stop') {
            broadcastDispatch('SPEAKING_STOP', {
                user_id: target,
                channel_id: activeVoiceChannel?.id || MOCK_CHANNEL.id,
            });
            console.log(`[MockDiscord] Simulated SPEAKING_STOP for user ${target}`);
        }
    });
}

server.listen(SOCKET_PATH, () => {
    console.log(`=======================================================`);
    console.log(` Mock Discord Desktop IPC Server Running`);
    console.log(` Listening on: ${SOCKET_PATH}`);
    console.log(` Mock Account: ${MOCK_USER.global_name} (@${MOCK_USER.username})`);
    console.log(` Voice Channel: ${MOCK_CHANNEL.name}`);
    console.log(`=======================================================`);
});

function cleanup() {
    console.log('\n[MockDiscord] Shutting down server...');
    server.close(() => {
        try {
            if (fs.existsSync(SOCKET_PATH)) {
                fs.unlinkSync(SOCKET_PATH);
            }
        } catch (_) {}
        process.exit(0);
    });
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
