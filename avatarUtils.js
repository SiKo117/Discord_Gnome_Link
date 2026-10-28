/**
 * Utility functions for Discord avatars (pure JS, usable in both GJS and Node.js)
 */

/**
 * Compute the public Discord CDN URL for a user's avatar.
 *
 * @param {object|null} user - Discord user object
 * @param {number} [size=64] - Target image resolution
 * @returns {string} CDN URL
 */
export function getAvatarUrl(user, size = 64) {
    if (!user) {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }

    // Direct URL already provided (e.g. in mock server or custom client)
    if (user.avatar && (user.avatar.startsWith('http://') || user.avatar.startsWith('https://'))) {
        return user.avatar;
    }

    // Discord CDN avatar hash
    if (user.avatar && user.id) {
        const isGif = typeof user.avatar === 'string' && user.avatar.startsWith('a_');
        const ext = isGif ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
    }

    // Default embed avatar index (0-5)
    let index = 0;
    try {
        if (user.discriminator && user.discriminator !== '0' && user.discriminator !== '0000') {
            index = parseInt(user.discriminator, 10) % 5;
        } else if (user.id) {
            index = Number((BigInt(user.id) >> 22n) % 6n);
        }
    } catch (_) {
        index = 0;
    }

    if (isNaN(index) || index < 0 || index > 5) {
        index = 0;
    }

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Generates a safe filename for disk caching based on user id and avatar hash.
 *
 * @param {object|null} user - Discord user object
 * @returns {string} Local cache filename
 */
export function getAvatarCacheFilename(user) {
    if (!user) return 'default_0.png';
    const id = user.id ? String(user.id).replace(/[^a-zA-Z0-9_-]/g, '') : 'unknown';

    if (user.avatar && (user.avatar.startsWith('http://') || user.avatar.startsWith('https://'))) {
        // Safe alphanumeric replacement for URLs
        const safeUrl = user.avatar.replace(/[^a-zA-Z0-9]/g, '_').slice(-32);
        return `${id}_${safeUrl}.png`;
    }

    const hash = user.avatar ? String(user.avatar).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
    return `${id}_${hash}.png`;
}
