// index.js
// Node.js 20 AWS Lambda — on-demand Drive -> WordPress gallery sync (Gutenberg block)
// Dedupe strategy: reuse existing WP media by filename/title (no custom meta).

// Import from modular files
const { env, parseBool, pickOrder, stripExt, makeUniqueFilename, basicAuthHeader, makeAnchorId } = require('./src/utils');
const { makeGalleryBlock, makeHeadingBlock, makeSpacerBlock, makeTocBlock, makeMasonryStyles, makeSectionContent, makePageContent } = require('./src/blocks');
const { loadCache, saveCache, isCacheValid } = require('./src/cache');
const { createDrive, makeGoogleDriveImageUrl, listSubFolders, listImagesInFolder, downloadDriveFile } = require('./src/drive');
const { resizeImageIfNeeded, DEFAULT_MAX_IMAGE_SIZE } = require('./src/image');
const { createWp } = require('./src/wordpress');
const { syncOnce } = require('./src/sync');
const { cleanupDuplicates } = require('./src/cleanup');
const { CLEANUP_DUPLICATES } = require('./config');

// ---------- exported for testing ----------
module.exports = {
    // utilities
    env,
    parseBool,
    pickOrder,
    stripExt,
    makeUniqueFilename,
    basicAuthHeader,
    makeAnchorId,
    // block generators
    makeGalleryBlock,
    makeHeadingBlock,
    makeSpacerBlock,
    makeTocBlock,
    makeMasonryStyles,
    makeSectionContent,
    makePageContent,
    // cache
    loadCache,
    saveCache,
    isCacheValid,
    // image processing
    resizeImageIfNeeded,
    // core
    createDrive,
    createWp,
    makeGoogleDriveImageUrl,
    listSubFolders,
    listImagesInFolder,
    downloadDriveFile,
    syncOnce,
    cleanupDuplicates,
    // Lambda handler (added below)
};

// ---------- Lambda handler ----------
module.exports.handler = async (event) => {
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
        const makeSections = parseBool(qs.makeSections ?? body.makeSections ?? env('MAKE_SECTIONS'), true);
        const usePhotosFromRoot = parseBool(qs.usePhotosFromRoot ?? body.usePhotosFromRoot ?? env('USE_PHOTOS_FROM_ROOT_FOLDER'), false);
        const forceReupload = parseBool(qs.forceReupload ?? body.forceReupload ?? env('FORCE_REUPLOAD'), false);
        const useGoogleDrivePhotos = parseBool(qs.useGoogleDrivePhotos ?? body.useGoogleDrivePhotos ?? env('USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY'), false);
        const maxSize = parseInt(qs.maxSize || body.maxSize || env('MAX_SIZE') || DEFAULT_MAX_IMAGE_SIZE, 10);
        const uploadLimit = parseInt(qs.uploadLimit || body.uploadLimit || env('UPLOAD_LIMIT') || '0', 10);

        const wpBaseUrl = qs.wpBaseUrl || body.wpBaseUrl || env('WP_BASE_URL');
        const wpUser = qs.wpUser || body.wpUser || env('WP_USERNAME');
        const wpPass = qs.wpPass || body.wpPass || env('WP_APP_PASSWORD');

        // Check if cleanup mode is enabled
        const cleanupMode = parseBool(
            qs.cleanupDuplicates ?? body.cleanupDuplicates ?? env('CLEANUP_DUPLICATES') ?? CLEANUP_DUPLICATES,
            false
        );

        let cleanupResult = null;
        if (cleanupMode) {
            // Run cleanup before sync
            cleanupResult = await cleanupDuplicates({
                wpBaseUrl,
                wpUser,
                wpPass,
                wpPageId,
                dryRun,
                refreshCache,
                forceReupload
            });
        }

        // Continue with normal sync
        const result = await syncOnce({
            driveFolderId,
            wpPageId,
            order,
            dryRun,
            clearContent,
            refreshCache,
            makeSections,
            usePhotosFromRoot,
            forceReupload,
            useGoogleDrivePhotos,
            maxSize,
            uploadLimit,
            wpBaseUrl,
            wpUser,
            wpPass
        });

        // Include cleanup result if it was run
        const response = { ok: true, result };
        if (cleanupResult) {
            response.cleanup = cleanupResult;
        }

        return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(response)
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