// src/cache.js
// WordPress media cache management

const fs = require('fs');

const CACHE_FILE = '.wp-media-cache.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load cache from disk
 * @returns {Object|null} Cache object or null if not found/invalid
 */
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            return data;
        }
    } catch (err) {
        console.log(`[cache] Failed to load cache: ${err.message}`);
    }
    return null;
}

/**
 * Save cache to disk
 * @param {Object} cache - Cache object with wpBaseUrl, lastUpdated, and media
 */
function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
        console.log(`[cache] Saved ${Object.keys(cache.media).length} media items to cache`);
    } catch (err) {
        console.log(`[cache] Failed to save cache: ${err.message}`);
    }
}

/**
 * Check if cache is valid (not expired and matches wpBaseUrl)
 * @param {Object|null} cache - Cache object
 * @param {string} wpBaseUrl - WordPress base URL
 * @returns {boolean} True if cache is valid
 */
function isCacheValid(cache, wpBaseUrl) {
    if (!cache || !cache.media) return false;
    if (cache.wpBaseUrl !== wpBaseUrl) return false;
    const age = Date.now() - (cache.lastUpdated || 0);
    return age < CACHE_MAX_AGE_MS;
}

module.exports = {
    loadCache,
    saveCache,
    isCacheValid,
    CACHE_FILE,
    CACHE_MAX_AGE_MS,
};

