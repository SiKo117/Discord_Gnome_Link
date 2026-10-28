import assert from 'node:assert';
import {
    OP_HANDSHAKE,
    OP_FRAME,
    OP_CLOSE,
    OP_PING,
    OP_PONG,
    encodeFrame,
    FrameDecoder
} from '../rpcProtocol.js';

console.log('Running rpcProtocol unit tests...');

// Test 1: Encoding and decoding a single frame
{
    const payload = { v: 1, client_id: '123456789' };
    const encoded = encodeFrame(OP_HANDSHAKE, payload);

    assert(encoded instanceof Uint8Array, 'Encoded should be Uint8Array');
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    const opcode = view.getUint32(0, true);
    const length = view.getUint32(4, true);

    assert.strictEqual(opcode, OP_HANDSHAKE);
    assert.strictEqual(length, encoded.length - 8);

    const decoder = new FrameDecoder();
    const frames = decoder.feed(encoded);

    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].opcode, OP_HANDSHAKE);
    assert.deepStrictEqual(frames[0].data, payload);
    console.log('✓ Test 1: Single frame encode/decode passed');
}

// Test 2: Multiple frames in a single chunk (packet coalescing)
{
    const payload1 = { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } };
    const payload2 = { cmd: 'SET_VOICE_SETTINGS', args: { mute: true } };

    const frame1 = encodeFrame(OP_FRAME, payload1);
    const frame2 = encodeFrame(OP_FRAME, payload2);

    const coalesced = new Uint8Array(frame1.length + frame2.length);
    coalesced.set(frame1, 0);
    coalesced.set(frame2, frame1.length);

    const decoder = new FrameDecoder();
    const frames = decoder.feed(coalesced);

    assert.strictEqual(frames.length, 2);
    assert.deepStrictEqual(frames[0].data, payload1);
    assert.deepStrictEqual(frames[1].data, payload2);
    console.log('✓ Test 2: Coalesced frames passed');
}

// Test 3: Fragmented frames (byte-by-byte feed)
{
    const payload = { cmd: 'GET_SELECTED_VOICE_CHANNEL', args: {}, nonce: 'abc-123' };
    const encoded = encodeFrame(OP_FRAME, payload);

    const decoder = new FrameDecoder();
    const receivedFrames = [];

    // Feed one byte at a time
    for (let i = 0; i < encoded.length; i++) {
        const singleByteChunk = encoded.subarray(i, i + 1);
        const frames = decoder.feed(singleByteChunk);
        if (frames.length > 0) {
            receivedFrames.push(...frames);
        }
    }

    assert.strictEqual(receivedFrames.length, 1);
    assert.strictEqual(receivedFrames[0].opcode, OP_FRAME);
    assert.deepStrictEqual(receivedFrames[0].data, payload);
    console.log('✓ Test 3: Byte-by-byte fragmented frame passed');
}

// Test 4: Split header across chunks
{
    const payload = { test: 'header split' };
    const encoded = encodeFrame(OP_FRAME, payload);

    const decoder = new FrameDecoder();
    // First 3 bytes of 8-byte header
    const f1 = decoder.feed(encoded.subarray(0, 3));
    assert.strictEqual(f1.length, 0);

    // Remaining bytes
    const f2 = decoder.feed(encoded.subarray(3));
    assert.strictEqual(f2.length, 1);
    assert.deepStrictEqual(f2[0].data, payload);
    console.log('✓ Test 4: Split header passed');
}

// Test 5: PING, PONG, and CLOSE opcodes
{
    const pingPayload = { nonce: 'ping-123' };
    const pingEncoded = encodeFrame(OP_PING, pingPayload);
    const decoder = new FrameDecoder();
    const pingFrames = decoder.feed(pingEncoded);
    assert.strictEqual(pingFrames.length, 1);
    assert.strictEqual(pingFrames[0].opcode, OP_PING);
    assert.deepStrictEqual(pingFrames[0].data, pingPayload);

    const pongPayload = { nonce: 'pong-123' };
    const pongEncoded = encodeFrame(OP_PONG, pongPayload);
    const pongFrames = decoder.feed(pongEncoded);
    assert.strictEqual(pongFrames.length, 1);
    assert.strictEqual(pongFrames[0].opcode, OP_PONG);
    assert.deepStrictEqual(pongFrames[0].data, pongPayload);

    const closePayload = { code: 4000, message: 'Closed' };
    const closeEncoded = encodeFrame(OP_CLOSE, closePayload);
    const closeFrames = decoder.feed(closeEncoded);
    assert.strictEqual(closeFrames.length, 1);
    assert.strictEqual(closeFrames[0].opcode, OP_CLOSE);
    assert.deepStrictEqual(closeFrames[0].data, closePayload);
    console.log('✓ Test 5: OP_PING, OP_PONG, OP_CLOSE frames passed');
}

console.log('All rpcProtocol tests passed successfully!');
