// src/wordpress.js
// WordPress REST API client

const axios = require('axios');
const FormData = require('form-data');
const { basicAuthHeader } = require('./utils');
const { loadCache, saveCache, isCacheValid } = require('./cache');

/**
 * Create WordPress REST API client
 * @param {string} baseUrl - WordPress base URL
 * @param {string} username - WordPress username
 * @param {string} appPassword - WordPress application password
 * @param {Object} options - Options object
 * @param {boolean} options.refreshCache - Whether to refresh the media cache
 * @returns {Object} WordPress client with methods
 */
function createWp(baseUrl, username, appPassword, { refreshCache = false } = {}) {
    const client = axios.create({
        baseURL: `${baseUrl.replace(/\/$/, '')}/wp-json`,
        headers: {
            Authorization: basicAuthHeader(username, appPassword),
            Accept: 'application/json'
        },
        maxBodyLength: Infinity,
        // timeout: 30000, // optionally set
    });

    // In-memory cache for this session
    let mediaCache = null; // { [filename]: { id, url } }

    function basenameFromUrl(u) {
        try {
            return new URL(u).pathname.split('/').pop() || '';
        } catch {
            const parts = String(u || '').split('/');
            return parts[parts.length - 1] || '';
        }
    }

    async function loadMediaCache() {
        // Try to load from disk first
        const diskCache = loadCache();
        if (!refreshCache && isCacheValid(diskCache, baseUrl)) {
            console.log(`[cache] Using cached media data (${Object.keys(diskCache.media).length} items)`);
            mediaCache = diskCache.media;
            return;
        }

        // Fetch all media from WordPress
        console.log(`[cache] Fetching all media from WordPress...`);
        mediaCache = {};
        let page = 1;
        let totalFetched = 0;

        while (true) {
            try {
                const response = await client.get(`/wp/v2/media?per_page=100&page=${page}`);
                const items = response.data;
                if (!items || items.length === 0) break;

                for (const it of items) {
                    const src = it.source_url || '';
                    const filename = basenameFromUrl(src).toLowerCase();
                    if (filename) {
                        mediaCache[filename] = {
                            id: it.id,
                            url: src
                        };
                    }
                }

                totalFetched += items.length;
                console.log(`[cache] Fetched page ${page} (${totalFetched} items so far)`);

                // Check if there are more pages
                const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
                if (page >= totalPages) break;
                page++;
            } catch (err) {
                if (err.response?.status === 401) {
                    throw new Error(`WordPress authentication failed (401) while fetching media. Check your WP_USERNAME and WP_APP_PASSWORD.`);
                }
                console.log(`[cache] Error fetching media page ${page}: ${err.message}`);
                break;
            }
        }

        // Save to disk
        saveCache({
            wpBaseUrl: baseUrl,
            lastUpdated: Date.now(),
            media: mediaCache
        });
    }

    function findMediaInCache(filename) {
        if (!mediaCache) return null;
        const nameLc = filename.toLowerCase();

        // Only check by exact filename match to avoid cross-folder collisions
        // when using unique filenames with folder prefixes
        if (mediaCache[nameLc]) {
            return { id: mediaCache[nameLc].id, source_url: mediaCache[nameLc].url };
        }
        return null;
    }

    function addToCache(filename, id, url) {
        if (!mediaCache) mediaCache = {};
        const nameLc = filename.toLowerCase();
        mediaCache[nameLc] = { id, url };

        // Update disk cache
        const diskCache = loadCache() || { wpBaseUrl: baseUrl, lastUpdated: Date.now(), media: {} };
        diskCache.media[nameLc] = { id, url };
        diskCache.lastUpdated = Date.now();
        saveCache(diskCache);
    }

    async function findMediaByFilename(filename) {
        // First check cache
        const cached = findMediaInCache(filename);
        if (cached) return cached;

        // Fall back to API search (in case cache is stale)
        // Only match by exact filename to avoid cross-folder collisions
        const nameLc = filename.toLowerCase();

        let items = [];
        try {
            // Search by filename without extension for better API results
            const { stripExt } = require('./utils');
            const nameNoExtLc = stripExt(filename).toLowerCase();
            items = await client.get(`/wp/v2/media?per_page=100&search=${encodeURIComponent(nameNoExtLc)}`)
                .then(r => r.data);
        } catch (err) {
            if (err.response?.status === 401) {
                throw new Error(`WordPress authentication failed (401) while searching media. Check your WP_USERNAME and WP_APP_PASSWORD.`);
            }
            items = [];
        }

        // Only match by exact filename from URL
        for (const it of items) {
            const src = it.source_url || '';
            const base = basenameFromUrl(src).toLowerCase();
            if (base === nameLc) {
                addToCache(filename, it.id, src);
                return it;
            }
        }
        return null;
    }

    async function uploadMedia(buf, filename, { caption, alt }, retries = 3) {
        const delays = [2000, 5000, 10000]; // exponential backoff: 2s, 5s, 10s
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const form = new FormData();
                form.append('file', buf, { filename });
                if (caption) form.append('caption', caption);
                const media = await client.post('/wp/v2/media', form, { headers: form.getHeaders() }).then(r => r.data);
                if (alt) await client.patch(`/wp/v2/media/${media.id}`, { alt_text: alt }).then(r => r.data);

                // Add to cache
                const url = media.source_url || '';
                addToCache(filename, media.id, url);

                return media;
            } catch (err) {
                lastError = err;

                if (err.response?.status === 401) {
                    throw new Error(`WordPress authentication failed (401) while uploading media. Check your WP_USERNAME and WP_APP_PASSWORD. The user may also lack permission to upload media.`);
                }

                // Retry on 503 (Service Unavailable) or 429 (Too Many Requests) or network errors
                const isRetryable = err.response?.status === 503 || err.response?.status === 429 || !err.response;

                if (isRetryable && attempt < retries) {
                    const delay = delays[attempt] || delays[delays.length - 1];
                    console.log(`[wp] Upload failed for "${filename}" (${err.response?.status || 'network error'}), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${retries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (err.response?.status === 503) {
                    const fileSizeMB = (buf.length / (1024 * 1024)).toFixed(2);
                    throw new Error(`WordPress server returned 503 Service Unavailable while uploading "${filename}" (${fileSizeMB}MB) after ${retries} retries. The server may be overloaded or have timeout issues.`);
                }

                throw err;
            }
        }

        throw lastError;
    }

    async function getPage(pageId) {
        try {
            return await client.get(`/wp/v2/pages/${pageId}`).then(r => r.data);
        } catch (err) {
            if (err.response?.status === 401) {
                throw new Error(`WordPress authentication failed (401). Check your WP_USERNAME and WP_APP_PASSWORD. The REST API may also be blocked by a security plugin. Error: ${err.response?.data?.message || err.message}`);
            }
            throw err;
        }
    }

    async function patchPageContent(pageId, content) {
        try {
            return await client.patch(`/wp/v2/pages/${pageId}`, { content }).then(r => r.data);
        } catch (err) {
            if (err.response?.status === 401) {
                throw new Error(`WordPress authentication failed (401) while updating page. Check your WP_USERNAME and WP_APP_PASSWORD. The user may also lack permission to edit pages.`);
            }
            throw err;
        }
    }

    return { loadMediaCache, findMediaByFilename, uploadMedia, getPage, patchPageContent };
}

module.exports = {
    createWp,
};

