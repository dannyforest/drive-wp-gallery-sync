// src/cache.test.js
const fs = require('fs');
const { loadCache, saveCache, isCacheValid, CACHE_FILE } = require('./cache');

describe('cache', () => {
    // Clean up cache file before and after tests
    beforeEach(() => {
        if (fs.existsSync(CACHE_FILE)) {
            fs.unlinkSync(CACHE_FILE);
        }
    });

    afterEach(() => {
        if (fs.existsSync(CACHE_FILE)) {
            fs.unlinkSync(CACHE_FILE);
        }
    });

    describe('loadCache', () => {
        it('returns null when cache file does not exist', () => {
            expect(loadCache()).toBeNull();
        });

        it('loads cache from disk', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                lastUpdated: Date.now(),
                media: { 'test.jpg': { id: 1, url: 'http://example.com/test.jpg' } }
            };
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');

            const loaded = loadCache();
            expect(loaded).toEqual(cache);
        });

        it('returns null for invalid JSON', () => {
            fs.writeFileSync(CACHE_FILE, 'invalid json', 'utf8');
            expect(loadCache()).toBeNull();
        });
    });

    describe('saveCache', () => {
        it('saves cache to disk', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                lastUpdated: Date.now(),
                media: { 'test.jpg': { id: 1, url: 'http://example.com/test.jpg' } }
            };

            saveCache(cache);

            expect(fs.existsSync(CACHE_FILE)).toBe(true);
            const loaded = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            expect(loaded).toEqual(cache);
        });

        it('formats JSON with indentation', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                lastUpdated: Date.now(),
                media: {}
            };

            saveCache(cache);

            const content = fs.readFileSync(CACHE_FILE, 'utf8');
            expect(content).toContain('\n'); // Should be formatted
        });
    });

    describe('isCacheValid', () => {
        it('returns false for null cache', () => {
            expect(isCacheValid(null, 'http://example.com')).toBe(false);
        });

        it('returns false for cache without media', () => {
            expect(isCacheValid({}, 'http://example.com')).toBe(false);
        });

        it('returns false for different wpBaseUrl', () => {
            const cache = {
                wpBaseUrl: 'http://other.com',
                media: {},
                lastUpdated: Date.now(),
            };
            expect(isCacheValid(cache, 'http://example.com')).toBe(false);
        });

        it('returns false for expired cache (>24 hours)', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                media: {},
                lastUpdated: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
            };
            expect(isCacheValid(cache, 'http://example.com')).toBe(false);
        });

        it('returns true for valid cache', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                media: { 'test.jpg': { id: 1, url: 'http://example.com/test.jpg' } },
                lastUpdated: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
            };
            expect(isCacheValid(cache, 'http://example.com')).toBe(true);
        });

        it('returns false for cache at exactly 24 hours', () => {
            const cache = {
                wpBaseUrl: 'http://example.com',
                media: {},
                lastUpdated: Date.now() - (24 * 60 * 60 * 1000), // exactly 24 hours
            };
            // Cache is invalid at exactly 24 hours (age >= CACHE_MAX_AGE_MS)
            expect(isCacheValid(cache, 'http://example.com')).toBe(false);
        });
    });
});

