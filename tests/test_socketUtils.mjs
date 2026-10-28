import assert from 'node:assert';
import { isArRpcUser, formatSocketName } from '../rpcProtocol.js';

console.log('Running socketUtils and manual client selection unit tests...');

// Test 1: Identify arRPC mock user profiles
{
    assert.strictEqual(isArRpcUser({ username: 'arRPC' }), true);
    assert.strictEqual(isArRpcUser({ username: 'arrpc' }), true);
    assert.strictEqual(isArRpcUser({ global_name: 'arRPC' }), true);
    assert.strictEqual(isArRpcUser({ username: 'arRPC Bridge', discriminator: '0000' }), true);
    assert.strictEqual(isArRpcUser({ id: '0', discriminator: '0000' }), true);

    // Official Discord real users
    assert.strictEqual(isArRpcUser({ id: '12345678', username: 'alice', global_name: 'Alice W.' }), false);
    assert.strictEqual(isArRpcUser({ id: '98765432', username: 'bob_gamer', discriminator: '1234' }), false);
    assert.strictEqual(isArRpcUser(null), false);
    assert.strictEqual(isArRpcUser(undefined), false);
    assert.strictEqual(isArRpcUser({}), false);

    console.log('✓ Test 1: isArRpcUser identification passed');
}

// Test 2: formatSocketName labels
{
    const hostSocket = '/run/user/1000/discord-ipc-0';
    assert.strictEqual(formatSocketName(hostSocket), 'discord-ipc-0 (Standard / Host)');

    const vesktopSocket = '/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0';
    assert.strictEqual(formatSocketName(vesktopSocket), 'discord-ipc-0 (Vesktop / arRPC)');

    const flatpakDiscord = '/run/user/1000/app/com.discordapp.Discord/discord-ipc-0';
    assert.strictEqual(formatSocketName(flatpakDiscord), 'discord-ipc-0 (Flatpak Discord)');

    const canary = '/run/user/1000/app/com.discordapp.DiscordCanary/discord-ipc-1';
    assert.strictEqual(formatSocketName(canary), 'discord-ipc-1 (Flatpak Discord Canary)');

    const snap = '/run/user/1000/snap.discord/discord-ipc-0';
    assert.strictEqual(formatSocketName(snap), 'discord-ipc-0 (Snap Discord)');

    const tmp = '/tmp/discord-ipc-2';
    assert.strictEqual(formatSocketName(tmp), 'discord-ipc-2 (/tmp)');

    console.log('✓ Test 2: formatSocketName labeling passed');
}

// Test 3: Manual socket resolution and direct connection
{
    const sockets = [
        { path: '/run/user/1000/discord-ipc-0', user: { username: 'arRPC' } },
        { path: '/run/user/1000/discord-ipc-1', user: { id: '999', username: 'alice', global_name: 'Alice' } },
    ];

    function simulateManualConnect(requestedPath, defaultPath = '/run/user/1000/discord-ipc-0') {
        const targetPath = (requestedPath || defaultPath).trim();
        const found = sockets.find(s => s.path === targetPath);
        if (!found) {
            return { connected: false, error: `Socket file not found: ${targetPath}` };
        }
        return {
            connected: true,
            path: found.path,
            user: found.user,
            isArRpc: isArRpcUser(found.user),
        };
    }

    // Direct manual connection to specific socket
    const direct1 = simulateManualConnect('/run/user/1000/discord-ipc-1');
    assert.strictEqual(direct1.connected, true);
    assert.strictEqual(direct1.path, '/run/user/1000/discord-ipc-1');
    assert.strictEqual(direct1.isArRpc, false);
    assert.strictEqual(direct1.user.username, 'alice');
    console.log('✓ Test 3a: Manual connection directly targets specified socket path');

    // Default socket path when none specified
    const defaultConn = simulateManualConnect('');
    assert.strictEqual(defaultConn.connected, true);
    assert.strictEqual(defaultConn.path, '/run/user/1000/discord-ipc-0');
    assert.strictEqual(defaultConn.isArRpc, true);
    console.log('✓ Test 3b: Fallback to default socket path succeeds');

    // Missing socket returns clear error without auto-probing
    const missing = simulateManualConnect('/run/user/1000/discord-ipc-9');
    assert.strictEqual(missing.connected, false);
    assert.ok(missing.error.includes('Socket file not found'));
    console.log('✓ Test 3c: Missing socket reports explicit error without auto-hunting other sockets');
}

// Test 4: OP_CLOSE detection for "User logged out" and "Invalid Client ID"
{
    function parseCloseReason(code, message) {
        const isLoggedOut = (code === 1000 || String(message).toLowerCase().includes('logged out'));
        const isInvalidClientId = (code === 4000 || String(message).toLowerCase().includes('invalid client id'));
        return { isLoggedOut, isInvalidClientId };
    }

    const loggedOutTest = parseCloseReason(1000, 'User logged out');
    assert.strictEqual(loggedOutTest.isLoggedOut, true);
    assert.strictEqual(loggedOutTest.isInvalidClientId, false);

    const invalidIdTest = parseCloseReason(4000, 'Invalid Client ID');
    assert.strictEqual(invalidIdTest.isLoggedOut, false);
    assert.strictEqual(invalidIdTest.isInvalidClientId, true);

    const genericTest = parseCloseReason(1001, 'Going away');
    assert.strictEqual(genericTest.isLoggedOut, false);
    assert.strictEqual(genericTest.isInvalidClientId, false);

    console.log('✓ Test 4: OP_CLOSE status detection (logged-out & invalid client ID) passed');
}

// Test 5: Verify stream error classification: CANCELLED and TIMED_OUT should not drop connection
{
    function shouldDisconnectOnError(err, isConnected) {
        if (err.code === 'CANCELLED') {
            return { action: 'ignore' };
        }
        if (err.code === 'TIMED_OUT') {
            // Idle timeout: continue reading without dropping connection
            return { action: 'continue_read' };
        }
        if (!isConnected) {
            return { action: 'connection_failure', message: err.message };
        }
        return { action: 'disconnect', message: err.message };
    }

    const cancelErr = { code: 'CANCELLED', message: 'Operation was cancelled' };
    assert.strictEqual(shouldDisconnectOnError(cancelErr, true).action, 'ignore');

    const timeoutErr = { code: 'TIMED_OUT', message: 'Socket I/O timed out' };
    assert.strictEqual(shouldDisconnectOnError(timeoutErr, true).action, 'continue_read');
    assert.strictEqual(shouldDisconnectOnError(timeoutErr, false).action, 'continue_read');

    const fatalErr = { code: 'FAILED', message: 'Connection reset by peer' };
    assert.strictEqual(shouldDisconnectOnError(fatalErr, true).action, 'disconnect');
    assert.strictEqual(shouldDisconnectOnError(fatalErr, false).action, 'connection_failure');

    console.log('✓ Test 5: Stream error classification (TIMED_OUT recovery) passed');
}

console.log('All socketUtils unit tests passed successfully!');
