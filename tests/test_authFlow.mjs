import assert from 'node:assert';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
    OP_HANDSHAKE,
    OP_FRAME,
    OP_CLOSE,
    encodeFrame,
    FrameDecoder,
} from '../rpcProtocol.js';

console.log('Running authFlow unit tests...');

// Test 1: Verify StreamKit Client ID format & scopes
{
    const STREAMKIT_CLIENT_ID = '207646673902501888';
    assert.strictEqual(typeof STREAMKIT_CLIENT_ID, 'string');
    assert.strictEqual(STREAMKIT_CLIENT_ID.length, 18);

    const authPayload = {
        cmd: 'AUTHORIZE',
        args: {
            client_id: STREAMKIT_CLIENT_ID,
            scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
            prompt: 'consent',
        },
        nonce: 'auth-test-nonce-1',
    };

    const encoded = encodeFrame(OP_FRAME, authPayload);
    const decoder = new FrameDecoder();
    const frames = decoder.feed(encoded);

    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].opcode, OP_FRAME);
    assert.strictEqual(frames[0].data.cmd, 'AUTHORIZE');
    assert.deepStrictEqual(frames[0].data.args.scopes, ['rpc', 'rpc.voice.read', 'rpc.voice.write']);
    console.log('✓ Test 1: AUTHORIZE frame encode/decode passed');
}

// Test 2: Verify AUTHENTICATE frame format
{
    const authPayload = {
        cmd: 'AUTHENTICATE',
        args: {
            access_token: 'test_token_abc_123',
        },
        nonce: 'auth-test-nonce-2',
    };

    const encoded = encodeFrame(OP_FRAME, authPayload);
    const decoder = new FrameDecoder();
    const frames = decoder.feed(encoded);

    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].opcode, OP_FRAME);
    assert.strictEqual(frames[0].data.cmd, 'AUTHENTICATE');
    assert.strictEqual(frames[0].data.args.access_token, 'test_token_abc_123');
    console.log('✓ Test 2: AUTHENTICATE frame encode/decode passed');
}

// Test 3: End-to-end mock IPC handshake, AUTHORIZE, and AUTHENTICATE flow
{
    const testSocketPath = `/tmp/test-auth-ipc-${Date.now()}`;
    if (fs.existsSync(testSocketPath)) fs.unlinkSync(testSocketPath);

    const server = net.createServer((socket) => {
        const decoder = new FrameDecoder();
        socket.on('data', (chunk) => {
            const frames = decoder.feed(chunk);
            for (const f of frames) {
                if (f.opcode === OP_HANDSHAKE) {
                    // Send READY dispatch
                    const ready = encodeFrame(OP_FRAME, {
                        cmd: 'DISPATCH',
                        evt: 'READY',
                        data: {
                            v: 1,
                            user: {
                                id: '1234567890',
                                username: 'RealTester',
                                global_name: 'Real Tester',
                            },
                        },
                    });
                    socket.write(Buffer.from(ready));
                } else if (f.opcode === OP_FRAME && f.data?.cmd === 'AUTHORIZE') {
                    // Send code
                    const res = encodeFrame(OP_FRAME, {
                        cmd: 'AUTHORIZE',
                        data: { code: 'test_auth_code_xyz' },
                        nonce: f.data.nonce,
                    });
                    socket.write(Buffer.from(res));
                } else if (f.opcode === OP_FRAME && f.data?.cmd === 'AUTHENTICATE') {
                    // Send authenticated
                    const res = encodeFrame(OP_FRAME, {
                        cmd: 'AUTHENTICATE',
                        data: {
                            user: { id: '1234567890', username: 'RealTester' },
                            scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
                        },
                        nonce: f.data.nonce,
                    });
                    socket.write(Buffer.from(res));
                } else if (f.opcode === OP_FRAME && f.data?.cmd === 'GET_SELECTED_VOICE_CHANNEL') {
                    // Return active voice channel
                    const res = encodeFrame(OP_FRAME, {
                        cmd: 'GET_SELECTED_VOICE_CHANNEL',
                        data: {
                            id: '9988776655',
                            name: 'General Chat',
                            guild_id: '1122334455',
                            voice_states: [
                                {
                                    user: { id: '1234567890', username: 'RealTester' },
                                    voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false },
                                },
                            ],
                        },
                        nonce: f.data.nonce,
                    });
                    socket.write(Buffer.from(res));
                }
            }
        });
    });

    await new Promise((resolve) => server.listen(testSocketPath, resolve));

    // Connect client
    const client = net.createConnection(testSocketPath);
    const clientDecoder = new FrameDecoder();
    const receivedEvents = [];

    const flowPromise = new Promise((resolve, reject) => {
        client.on('data', (data) => {
            const frames = clientDecoder.feed(new Uint8Array(data));
            for (const f of frames) {
                receivedEvents.push(f);

                if (f.data?.cmd === 'DISPATCH' && f.data?.evt === 'READY') {
                    // After READY, client initiates AUTHORIZE
                    const authFrame = encodeFrame(OP_FRAME, {
                        cmd: 'AUTHORIZE',
                        args: {
                            client_id: '207646673902501888',
                            scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
                        },
                        nonce: 'step-authorize',
                    });
                    client.write(Buffer.from(authFrame));
                } else if (f.data?.cmd === 'AUTHORIZE') {
                    assert.strictEqual(f.data.data.code, 'test_auth_code_xyz');
                    // Exchange code -> client authenticates
                    const authFrame = encodeFrame(OP_FRAME, {
                        cmd: 'AUTHENTICATE',
                        args: { access_token: 'fake_token_from_streamkit' },
                        nonce: 'step-authenticate',
                    });
                    client.write(Buffer.from(authFrame));
                } else if (f.data?.cmd === 'AUTHENTICATE') {
                    // Now authenticated -> can query voice channel
                    const channelFrame = encodeFrame(OP_FRAME, {
                        cmd: 'GET_SELECTED_VOICE_CHANNEL',
                        args: {},
                        nonce: 'step-voice-channel',
                    });
                    client.write(Buffer.from(channelFrame));
                } else if (f.data?.cmd === 'GET_SELECTED_VOICE_CHANNEL') {
                    assert.strictEqual(f.data.data.name, 'General Chat');
                    assert.strictEqual(f.data.data.voice_states.length, 1);
                    resolve();
                }
            }
        });

        client.on('error', reject);
    });

    // Initiate Handshake
    const handshake = encodeFrame(OP_HANDSHAKE, { v: 1, client_id: '207646673902501888' });
    client.write(Buffer.from(handshake));

    await flowPromise;
    client.end();
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(testSocketPath)) fs.unlinkSync(testSocketPath);

    console.log('✓ Test 3: End-to-end handshake, AUTHORIZE, AUTHENTICATE, and GET_SELECTED_VOICE_CHANNEL flow passed');
}

// Test 4: Member voice state normalization (self_mute and self_deaf)
{
    const memberVariant1 = {
        user: { id: '1', username: 'alice' },
        voice_state: { mute: false, deaf: false, self_mute: true, self_deaf: false },
    };

    const memberVariant2 = {
        user: { id: '2', username: 'bob' },
        mute: false,
        deaf: true,
        self_mute: false,
        self_deaf: true,
    };

    const isMuted1 = Boolean(memberVariant1.voice_state?.mute || memberVariant1.voice_state?.self_mute || memberVariant1.mute || memberVariant1.self_mute);
    const isDeaf1 = Boolean(memberVariant1.voice_state?.deaf || memberVariant1.voice_state?.self_deaf || memberVariant1.deaf || memberVariant1.self_deaf);

    const isMuted2 = Boolean(memberVariant2.voice_state?.mute || memberVariant2.voice_state?.self_mute || memberVariant2.mute || memberVariant2.self_mute);
    const isDeaf2 = Boolean(memberVariant2.voice_state?.deaf || memberVariant2.voice_state?.self_deaf || memberVariant2.deaf || memberVariant2.self_deaf);

    assert.strictEqual(isMuted1, true, 'Variant 1 should detect self_mute');
    assert.strictEqual(isDeaf1, false, 'Variant 1 should not be deaf');
    assert.strictEqual(isMuted2, false, 'Variant 2 should not be muted');
    assert.strictEqual(isDeaf2, true, 'Variant 2 should detect deaf');
    console.log('✓ Test 4: Member voice state normalization passed');
}

console.log('All authFlow tests passed successfully!');
