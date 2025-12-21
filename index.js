// index.js
// Node.js 20 AWS Lambda — on-demand Drive -> WordPress gallery sync (Gutenberg block)
// Dedupe strategy: reuse existing WP media by filename/title (no custom meta).

const { google } = require('googleapis');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const fs = require('fs');

const DEFAULT_MAX_IMAGE_SIZE = 1024;
const CACHE_FILE = '.wp-media-cache.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------- cache ----------
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

function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
        console.log(`[cache] Saved ${Object.keys(cache.media).length} media items to cache`);
    } catch (err) {
        console.log(`[cache] Failed to save cache: ${err.message}`);
    }
}

function isCacheValid(cache, wpBaseUrl) {
    if (!cache || !cache.media) return false;
    if (cache.wpBaseUrl !== wpBaseUrl) return false;
    const age = Date.now() - (cache.lastUpdated || 0);
    return age < CACHE_MAX_AGE_MS;
}

// ---------- util ----------
function env(name, fallback) {
    const v = process.env[name];
    return (v === undefined || v === null || v === '') ? fallback : v;
}

function parseBool(v, def = false) {
    if (v === undefined || v === null) return def;
    return String(v).toLowerCase() === 'true';
}

function pickOrder(order) {
    return ({
        name_asc: (a, b) => a.name.localeCompare(b.name),
        name_desc: (a, b) => b.name.localeCompare(a.name),
        modified_desc: (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime),
        modified_asc: (a, b) => new Date(a.modifiedTime) - new Date(b.modifiedTime),
    }[order] || ((a, b) => a.name.localeCompare(b.name)));
}

function makeMasonryStyles() {
    // CSS for masonry layout using CSS columns - included once at the top of page
    return `<!-- wp:html -->
<style>
.masonry-gallery.wp-block-gallery {
    display: block !important;
    column-count: 3;
    column-gap: 10px;
}
.masonry-gallery.wp-block-gallery .wp-block-image {
    break-inside: avoid;
    margin-bottom: 10px !important;
    width: 100% !important;
}
.masonry-gallery.wp-block-gallery .wp-block-image img {
    width: 100%;
    height: auto !important;
    object-fit: contain;
    border-radius: 4px;
}
.masonry-gallery.wp-block-gallery .wp-block-image figure {
    margin: 0;
    height: auto !important;
}
@media (max-width: 900px) {
    .masonry-gallery.wp-block-gallery { column-count: 2; }
}
@media (max-width: 500px) {
    .masonry-gallery.wp-block-gallery { column-count: 1; }
}
</style>
<!-- /wp:html -->`;
}

function makeGalleryBlock(attachments, groupId = 'all-photos') {
    // attachments = [{ id, url, alt }, ...]
    // Use WordPress blocks for lightbox, but add masonry-gallery class for CSS styling
    const imageBlocks = attachments.map(({ id, url, alt }) =>
        `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"media","lightbox":{"enabled":true,"group":"${groupId}"}} -->\n<figure class="wp-block-image size-large"><a href="${url}"><img src="${url}" alt="${alt || ''}" class="wp-image-${id}"/></a></figure>\n<!-- /wp:image -->`
    ).join('\n');

    // Add masonry-gallery class and remove is-cropped
    return `<!-- wp:gallery {"linkTo":"media","lightbox":{"enabled":true,"group":"${groupId}"},"className":"masonry-gallery"} -->\n<figure class="wp-block-gallery has-nested-images columns-default masonry-gallery">\n${imageBlocks}\n</figure>\n<!-- /wp:gallery -->`;
}

function makeAnchorId(text) {
    // Convert text to a valid HTML anchor ID
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function makeHeadingBlock(text, level = 2, anchor = null) {
    const anchorAttr = anchor ? `,"anchor":"${anchor}"` : '';
    const idAttr = anchor ? ` id="${anchor}"` : '';
    return `<!-- wp:heading {"level":${level}${anchorAttr}} -->\n<h${level}${idAttr} class="wp-block-heading">${text}</h${level}>\n<!-- /wp:heading -->`;
}

function makeSpacerBlock(height = 50) {
    return `<!-- wp:spacer {"height":"${height}px"} -->\n<div style="height:${height}px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`;
}

function makeTocBlock(sections) {
    // Create a dropdown (select) for navigation to save space
    const options = sections.map(({ name }) => {
        const anchor = makeAnchorId(name);
        return `<option value="#${anchor}">${name}</option>`;
    }).join('\n');

    const dropdownHtml = `<div class="toc-dropdown" style="margin-bottom: 1.5em;">
<label for="toc-select" style="font-weight: bold; margin-right: 0.5em;">Aller à la section:</label>
<select id="toc-select" onchange="if(this.value) window.location.hash = this.value;" style="padding: 0.5em; font-size: 1em; min-width: 200px;">
<option value="">-- Choisir une section --</option>
${options}
</select>
</div>`;

    return `<!-- wp:html -->\n${dropdownHtml}\n<!-- /wp:html -->`;
}

function makeSectionContent(sections) {
    // sections = [{ name, attachments: [{ id, url, alt }, ...] }, ...]
    const spacer = makeSpacerBlock(30);
    return sections.map(({ name, attachments }) => {
        const anchor = makeAnchorId(name);
        const heading = makeHeadingBlock(name, 2, anchor);
        const gallery = makeGalleryBlock(attachments);
        return `${heading}\n\n${gallery}`;
    }).join(`\n\n${spacer}\n\n`);
}

function makePageContent(sections) {
    const styles = makeMasonryStyles();
    const toc = makeTocBlock(sections);
    const spacerAfterToc = makeSpacerBlock(50);
    const sectionContent = makeSectionContent(sections);
    return `${styles}\n\n${toc}\n\n${spacerAfterToc}\n\n${sectionContent}`;
}

function basicAuthHeader(user, pass) {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function stripExt(name) {
    return name.replace(/\.[^.]+$/, '');
}

// ---------- Google Drive ----------
async function createDrive() {
    const json = env('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is required');

    let creds;
    try {
        creds = JSON.parse(json);
    } catch (e) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }

    const auth = new google.auth.JWT(
        creds.client_email,
        null,
        creds.private_key,
        ['https://www.googleapis.com/auth/drive.readonly']
    );
    await auth.authorize();
    return google.drive({ version: 'v3', auth });
}

async function listSubFolders(drive, folderId) {
    const folders = [];
    let pageToken = null;
    do {
        const { data } = await drive.files.list({
            q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            pageToken
        });
        folders.push(...(data.files || []));
        pageToken = data.nextPageToken || null;
    } while (pageToken);
    // Sort folders alphabetically by name
    folders.sort((a, b) => a.name.localeCompare(b.name));
    return folders;
}

async function listImagesInFolder(drive, folderId) {
    const out = [];
    let pageToken = null;
    do {
        const { data } = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, description)',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            pageToken
        });

        for (const f of data.files || []) {
            if ((f.mimeType || '').startsWith('image/')) {
                out.push(f);
            }
        }
        pageToken = data.nextPageToken || null;
    } while (pageToken);
    return out;
}

async function downloadDriveFile(drive, fileId) {
    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(res.data);
}

async function resizeImageIfNeeded(buf, maxSize) {
    if (!maxSize || maxSize <= 0) return buf;

    const image = sharp(buf);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    if (!width || !height) return buf;

    if (width <= maxSize && height <= maxSize) return buf;

    // Resize so the largest dimension equals maxSize, maintaining aspect ratio
    const resized = await image
        .resize({
            width: width > height ? maxSize : undefined,
            height: height >= width ? maxSize : undefined,
            fit: 'inside',
            withoutEnlargement: true
        })
        .toBuffer();

    return resized;
}

// ---------- WordPress ----------
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
                    // Also index by title
                    const titleRendered = (it.title && it.title.rendered) ? it.title.rendered : '';
                    const titleText = titleRendered.replace(/<[^>]*>/g, '').trim().toLowerCase();
                    if (titleText && !mediaCache[titleText]) {
                        mediaCache[titleText] = {
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
        const nameNoExtLc = stripExt(filename).toLowerCase();

        // Check by filename
        if (mediaCache[nameLc]) {
            return { id: mediaCache[nameLc].id, source_url: mediaCache[nameLc].url };
        }
        // Check by title (without extension)
        if (mediaCache[nameNoExtLc]) {
            return { id: mediaCache[nameNoExtLc].id, source_url: mediaCache[nameNoExtLc].url };
        }
        return null;
    }

    function addToCache(filename, id, url) {
        if (!mediaCache) mediaCache = {};
        const nameLc = filename.toLowerCase();
        const nameNoExtLc = stripExt(filename).toLowerCase();
        mediaCache[nameLc] = { id, url };
        mediaCache[nameNoExtLc] = { id, url };

        // Update disk cache
        const diskCache = loadCache() || { wpBaseUrl: baseUrl, lastUpdated: Date.now(), media: {} };
        diskCache.media[nameLc] = { id, url };
        diskCache.media[nameNoExtLc] = { id, url };
        diskCache.lastUpdated = Date.now();
        saveCache(diskCache);
    }

    async function findMediaByFilename(filename) {
        // First check cache
        const cached = findMediaInCache(filename);
        if (cached) return cached;

        // Fall back to API search (in case cache is stale)
        const nameLc = filename.toLowerCase();
        const nameNoExtLc = stripExt(filename).toLowerCase();

        let items = [];
        try {
            items = await client.get(`/wp/v2/media?per_page=100&search=${encodeURIComponent(nameNoExtLc)}`)
                .then(r => r.data);
        } catch (err) {
            if (err.response?.status === 401) {
                throw new Error(`WordPress authentication failed (401) while searching media. Check your WP_USERNAME and WP_APP_PASSWORD.`);
            }
            items = [];
        }

        for (const it of items) {
            const src = it.source_url || '';
            const base = basenameFromUrl(src).toLowerCase();
            if (base === nameLc) {
                addToCache(filename, it.id, src);
                return it;
            }

            const titleRendered = (it.title && it.title.rendered) ? it.title.rendered : '';
            const titleText = titleRendered.replace(/<[^>]*>/g, '').trim().toLowerCase();
            if (titleText === nameNoExtLc) {
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

// ---------- sync ----------
async function syncOnce({
    driveFolderId,
    wpPageId,
    order = 'name_asc',
    dryRun = false,
    clearContent = false,
    refreshCache = false,
    maxSize = DEFAULT_MAX_IMAGE_SIZE,
    uploadLimit = 0,
    wpBaseUrl,
    wpUser,
    wpPass
}) {
    if (!driveFolderId) throw new Error('driveFolderId required');
    if (!wpPageId) throw new Error('wpPageId required');
    if (!wpBaseUrl || !wpUser || !wpPass) throw new Error('WP credentials/baseUrl required');

    const drive = await createDrive();
    const wp = createWp(wpBaseUrl, wpUser, wpPass, { refreshCache });

    // Load/refresh WordPress media cache
    await wp.loadMediaCache();

    // 1) list sub-folders (sorted alphabetically)
    const subFolders = await listSubFolders(drive, driveFolderId);
    console.log(`[sync] Found ${subFolders.length} sub-folders`);

    // 2) process each sub-folder
    const sections = []; // { name, attachments: [{ id, url, alt }, ...] }
    const toUpload = [];
    const reused = [];
    let totalUploaded = 0;

    for (const folder of subFolders) {
        console.log(`[sync] Processing folder: ${folder.name}`);
        const files = await listImagesInFolder(drive, folder.id);
        files.sort(pickOrder(order));

        const attachments = [];

        for (const f of files) {
            const filename = f.name || `${f.id}.jpg`;
            const alt = stripExt(filename);

            // try to reuse existing
            const existing = await wp.findMediaByFilename(filename);
            if (existing) {
                const url = existing.source_url || existing.media_details?.sizes?.large?.source_url || '';
                attachments.push({ id: existing.id, url, alt });
                reused.push({ folder: folder.name, filename });
                continue;
            }

            // Check upload limit (0 or -1 = no limit)
            if (uploadLimit > 0 && totalUploaded >= uploadLimit) {
                continue;
            }

            if (dryRun) {
                toUpload.push({ folder: folder.name, filename });
                totalUploaded++;
                continue;
            }

            let buf = await downloadDriveFile(drive, f.id);
            buf = await resizeImageIfNeeded(buf, maxSize);
            const media = await wp.uploadMedia(buf, filename, {
                caption: f.description || '',
                alt
            });
            const url = media.source_url || media.media_details?.sizes?.large?.source_url || '';
            attachments.push({ id: media.id, url, alt });
            toUpload.push({ folder: folder.name, filename });
            totalUploaded++;
        }

        if (attachments.length > 0) {
            sections.push({ name: folder.name, attachments });
        }
    }

    // 3) write/replace content on page (all sections)
    if (!dryRun) {
        const page = await wp.getPage(wpPageId);
        const prevContent = (page.content && (page.content.raw || page.content.rendered)) || '';
        console.log(`[sync] Previous content length: ${prevContent.length}`);

        const newPageContent = makePageContent(sections);
        console.log(`[sync] Generated ${sections.length} sections with table of contents`);

        let newContent;
        if (clearContent) {
            // Clear all existing content and replace with new content
            console.log(`[sync] Clearing existing page content`);
            newContent = newPageContent;
        } else {
            // Replace all existing content (TOC + heading+gallery blocks), or append if none exist
            // Match from first wp:heading (TOC) to last wp:gallery end
            const sectionPattern = /<!--\s*wp:heading[\s\S]*<!--\s*\/wp:gallery\s*-->/g;
            const hasExistingSections = sectionPattern.test(prevContent);

            if (hasExistingSections) {
                // Replace all section content (including old TOC)
                newContent = prevContent.replace(sectionPattern, '').trim();
                newContent = newContent ? `${newContent}\n\n${newPageContent}` : newPageContent;
            } else {
                newContent = prevContent ? `${prevContent}\n\n${newPageContent}` : newPageContent;
            }
        }

        console.log(`[sync] New content length: ${newContent.length}`);
        await wp.patchPageContent(wpPageId, newContent);
        console.log(`[sync] Page content patched`);
    }

    const totalImages = sections.reduce((sum, s) => sum + s.attachments.length, 0);

    return {
        uploadedCount: toUpload.length,
        reusedCount: reused.length,
        totalIdsInGallery: totalImages,
        sectionsCount: sections.length,
        sections: sections.map(s => ({ name: s.name, imageCount: s.attachments.length })),
        pageId: wpPageId,
        updated: !dryRun,
        images: {
            toUpload,
            reused
        }
    };
}

// ---------- Lambda handler ----------
exports.handler = async (event) => {
    try {
        const qs = event.queryStringParameters || {};
        const isJson = event.headers && /json/i.test(event.headers['content-type'] || '');
        const body = isJson && event.body ? JSON.parse(event.body) : {};

        const driveFolderId = qs.folderId || body.folderId || env('GOOGLE_DRIVE_FOLDER_ID');
        const wpPageId = parseInt(qs.pageId || body.pageId || env('WP_PAGE_ID'), 10);

        const order = (qs.order || body.order || env('ORDER') || 'name_asc');
        const dryRun = parseBool(qs.dryRun ?? body.dryRun ?? env('DRY_RUN'), false);
        const clearContent = parseBool(qs.clearContent ?? body.clearContent ?? env('CLEAR_CONTENT'), false);
        const refreshCache = parseBool(qs.refreshCache ?? body.refreshCache ?? env('REFRESH_CACHE'), false);
        const maxSize = parseInt(qs.maxSize || body.maxSize || env('MAX_SIZE') || DEFAULT_MAX_IMAGE_SIZE, 10);
        const uploadLimit = parseInt(qs.uploadLimit || body.uploadLimit || env('UPLOAD_LIMIT') || '0', 10);

        const wpBaseUrl = qs.wpBaseUrl || body.wpBaseUrl || env('WP_BASE_URL');
        const wpUser = qs.wpUser || body.wpUser || env('WP_USERNAME');
        const wpPass = qs.wpPass || body.wpPass || env('WP_APP_PASSWORD');

        const result = await syncOnce({
            driveFolderId,
            wpPageId,
            order,
            dryRun,
            clearContent,
            refreshCache,
            maxSize,
            uploadLimit,
            wpBaseUrl,
            wpUser,
            wpPass
        });

        return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true, result })
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: false, error: err.message })
        };
    }
};