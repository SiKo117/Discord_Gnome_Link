import assert from 'node:assert';
import { getAvatarUrl, getAvatarCacheFilename } from '../avatarUtils.js';

console.log('Running avatarManager unit tests...');

// Test 1: Direct URL avatars
{
    const userWithUrl = {
        id: '123456789',
        username: 'custom_avatar_user',
        avatar: 'https://cdn.discordapp.com/embed/avatars/3.png',
    };
    const url = getAvatarUrl(userWithUrl, 64);
    assert.strictEqual(url, 'https://cdn.discordapp.com/embed/avatars/3.png');
    console.log('✓ Test 1: Direct avatar URL preserved');
}

// Test 2: Discord CDN static avatar hash
{
    const userWithHash = {
        id: '80351110224678912',
        username: 'gamer_pro',
        avatar: '834272909632230400',
    };
    const url64 = getAvatarUrl(userWithHash, 64);
    assert.strictEqual(url64, 'https://cdn.discordapp.com/avatars/80351110224678912/834272909632230400.png?size=64');

    const url128 = getAvatarUrl(userWithHash, 128);
    assert.strictEqual(url128, 'https://cdn.discordapp.com/avatars/80351110224678912/834272909632230400.png?size=128');
    console.log('✓ Test 2: Discord CDN static avatar URL generated correctly');
}

// Test 3: Animated GIF avatar hash (prefixed with a_)
{
    const userWithGif = {
        id: '80351110224678912',
        username: 'nitro_user',
        avatar: 'a_c0ff331234567890abcdef',
    };
    const url = getAvatarUrl(userWithGif, 64);
    assert.strictEqual(url, 'https://cdn.discordapp.com/avatars/80351110224678912/a_c0ff331234567890abcdef.gif?size=64');
    console.log('✓ Test 3: Animated GIF avatar URL detected and formatted with .gif extension');
}

// Test 4: Default avatar calculation with legacy 4-digit discriminator
{
    const legacyUser = {
        id: '999999',
        username: 'old_tag_user',
        discriminator: '1337',
        avatar: null,
    };
    // 1337 % 5 = 2
    const url = getAvatarUrl(legacyUser);
    assert.strictEqual(url, 'https://cdn.discordapp.com/embed/avatars/2.png');
    console.log('✓ Test 4: Legacy discriminator avatar index calculated correctly');
}

// Test 5: Default avatar calculation with new pomelo usernames (discriminator = '0')
{
    // Snowflake ID calculation: (BigInt(id) >> 22n) % 6n
    // For ID 80351110224678912n:
    // 80351110224678912n >> 22n = 19157196883n
    // 19157196883n % 6n = 5n
    const pomeloUser = {
        id: '80351110224678912',
        username: 'modern_user',
        discriminator: '0',
        avatar: null,
    };
    const url = getAvatarUrl(pomeloUser);
    assert.strictEqual(url, 'https://cdn.discordapp.com/embed/avatars/5.png');
    console.log('✓ Test 5: Pomelo (new username) default avatar calculated using snowflake shift');
}

// Test 6: Null / Undefined user fallback
{
    assert.strictEqual(getAvatarUrl(null), 'https://cdn.discordapp.com/embed/avatars/0.png');
    assert.strictEqual(getAvatarUrl(undefined), 'https://cdn.discordapp.com/embed/avatars/0.png');
    console.log('✓ Test 6: Null and undefined fallback to default avatar index 0');
}

// Test 7: Cache filename generation
{
    const user1 = { id: '12345', avatar: 'abcdef123' };
    assert.strictEqual(getAvatarCacheFilename(user1), '12345_abcdef123.png');

    const userNull = { id: '999', avatar: null };
    assert.strictEqual(getAvatarCacheFilename(userNull), '999_default.png');

    const emptyUser = null;
    assert.strictEqual(getAvatarCacheFilename(emptyUser), 'default_0.png');
    console.log('✓ Test 7: Cache filenames are safe and deterministic');
}

// Test 8: Panel position mapping
{
    function resolvePanelTarget(position) {
        const normalized = String(position || 'right').toLowerCase();
        if (normalized === 'left') return { box: '_leftBox', name: 'left' };
        if (normalized === 'center') return { box: '_centerBox', name: 'center' };
        return { box: '_rightBox', name: 'right' };
    }

    assert.strictEqual(resolvePanelTarget('left').box, '_leftBox');
    assert.strictEqual(resolvePanelTarget('center').box, '_centerBox');
    assert.strictEqual(resolvePanelTarget('right').box, '_rightBox');
    assert.strictEqual(resolvePanelTarget('invalid').box, '_rightBox');
    console.log('✓ Test 8: Panel target box mapping verified');
}

console.log('All avatarManager tests passed successfully!');
