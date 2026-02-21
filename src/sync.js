// src/sync.js
// Main sync logic for Google Drive to WordPress gallery sync

const { pickOrder, makeUniqueFilename } = require('./utils');
const { makePageContent } = require('./blocks');
const { createDrive, makeGoogleDriveImageUrl, listSubFolders, listImagesInFolder, downloadDriveFile } = require('./drive');
const { createWp } = require('./wordpress');
const { resizeImageIfNeeded, DEFAULT_MAX_IMAGE_SIZE } = require('./image');

/**
 * Sync Google Drive folder to WordPress page gallery
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync result with statistics
 */
async function syncOnce({
    driveFolderId,
    wpPageId,
    order = 'name_asc',
    dryRun = false,
    clearContent = false,
    refreshCache = false,
    maxSize = DEFAULT_MAX_IMAGE_SIZE,
    uploadLimit = 0,
    makeSections = true,
    usePhotosFromRoot = false,
    forceReupload = false,
    useGoogleDrivePhotos = false,
    wpBaseUrl,
    wpUser,
    wpPass
}) {
    if (!driveFolderId) throw new Error('driveFolderId required');
    if (!wpPageId) throw new Error('wpPageId required');
    if (!wpBaseUrl || !wpUser || !wpPass) throw new Error('WP credentials/baseUrl required');

    const drive = await createDrive();
    const wp = createWp(wpBaseUrl, wpUser, wpPass, { refreshCache });

    // Log which mode we're using
    if (useGoogleDrivePhotos) {
        console.log(`[sync] Using Google Drive URLs directly (no WordPress upload)`);
    } else {
        console.log(`[sync] Uploading images to WordPress Media Library`);
        // Load/refresh WordPress media cache only if we're uploading to WordPress
        await wp.loadMediaCache();
    }

    // 1) list sub-folders (sorted alphabetically)
    const subFolders = await listSubFolders(drive, driveFolderId);
    console.log(`[sync] Found ${subFolders.length} sub-folders`);

    // 2) process each sub-folder
    const sections = []; // { name, attachments: [{ id, url, alt }, ...] }
    const toUpload = [];
    const reused = [];
    const skippedFiles = []; // Track files that failed to process
    let totalUploaded = 0;
    // Track which WP media IDs have been used in this sync to avoid duplicates across sections
    // This prevents the same WP media being used for different Drive files with same filename
    const usedMediaIds = new Set();

    // Helper function to process images from a folder
    async function processFolderImages(folderId, folderName) {
        console.log(`[sync] Processing folder: ${folderName}`);
        const files = await listImagesInFolder(drive, folderId);
        files.sort(pickOrder(order));

        const attachments = [];
        const skipped = [];

        for (const f of files) {
            const filename = f.name || `${f.id}.jpg`;
            const alt = ''; // Empty alt text to prevent filename from showing in lightbox

            // If using Google Drive photos directly, skip upload and use Drive URL
            if (useGoogleDrivePhotos) {
                try {
                    const url = makeGoogleDriveImageUrl(f.id);
                    // Use Drive file ID as the attachment ID for gallery block
                    // This ensures unique IDs even though we're not using WordPress media
                    const id = f.id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10); // Sanitize for use in HTML
                    attachments.push({ id, url, alt });
                    console.log(`[sync] Using Google Drive URL for "${filename}"`);
                } catch (err) {
                    const errorMsg = err.message || String(err);
                    console.log(`[sync] Skipping "${filename}" in folder "${folderName}": ${errorMsg}`);
                    skipped.push({ folder: folderName, filename, error: errorMsg });
                }
                continue;
            }

            // WordPress upload mode (original behavior)
            // Create unique filename by prefixing with folder name to handle duplicates across folders
            const uniqueFilename = makeUniqueFilename(folderName, filename);

            // try to reuse existing - search by unique filename first, then by original filename
            // Skip this check if forceReupload is enabled
            if (!forceReupload) {
                let existing = await wp.findMediaByFilename(uniqueFilename);
                if (!existing) {
                    // Fallback to original filename for backwards compatibility
                    existing = await wp.findMediaByFilename(filename);
                }

                if (existing && !usedMediaIds.has(existing.id)) {
                    const url = existing.source_url || existing.media_details?.sizes?.large?.source_url || '';
                    attachments.push({ id: existing.id, url, alt });
                    usedMediaIds.add(existing.id);
                    reused.push({ folder: folderName, filename });
                    continue;
                }
            }

            // Check upload limit (0 or -1 = no limit)
            if (uploadLimit > 0 && totalUploaded >= uploadLimit) {
                continue;
            }

            if (dryRun) {
                toUpload.push({ folder: folderName, filename });
                totalUploaded++;
                continue;
            }

            try {
                let buf = await downloadDriveFile(drive, f.id);
                buf = await resizeImageIfNeeded(buf, maxSize);
                // Upload with unique filename to prevent conflicts
                const media = await wp.uploadMedia(buf, uniqueFilename, {
                    caption: f.description || '',
                    alt
                });
                const url = media.source_url || media.media_details?.sizes?.large?.source_url || '';
                attachments.push({ id: media.id, url, alt });
                usedMediaIds.add(media.id);
                toUpload.push({ folder: folderName, filename });
                totalUploaded++;
            } catch (err) {
                // Skip images that fail to process (e.g., unsupported formats, corrupt files)
                const errorMsg = err.message || String(err);
                console.log(`[sync] Skipping "${filename}" in folder "${folderName}": ${errorMsg}`);
                skipped.push({ folder: folderName, filename, error: errorMsg });
            }
        }

        return { attachments, skipped };
    }

    // Process root folder photos if enabled
    if (usePhotosFromRoot) {
        const { attachments: rootAttachments, skipped } = await processFolderImages(driveFolderId, 'Root');
        skippedFiles.push(...skipped);
        if (rootAttachments.length > 0) {
            sections.push({ name: 'Root', attachments: rootAttachments });
        }
    }

    // Process sub-folders
    for (const folder of subFolders) {
        const { attachments, skipped } = await processFolderImages(folder.id, folder.name);
        skippedFiles.push(...skipped);
        if (attachments.length > 0) {
            sections.push({ name: folder.name, attachments });
        }
    }

    // 3) write/replace content on page (all sections)
    if (!dryRun) {
        const page = await wp.getPage(wpPageId);
        const prevContent = (page.content && (page.content.raw || page.content.rendered)) || '';
        console.log(`[sync] Previous content length: ${prevContent.length}`);

        const newPageContent = makePageContent(sections, makeSections);
        if (makeSections) {
            console.log(`[sync] Generated ${sections.length} sections with table of contents`);
        } else {
            console.log(`[sync] Generated single gallery with ${sections.reduce((sum, s) => sum + s.attachments.length, 0)} images`);
        }

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

    // Log summary of skipped files
    if (skippedFiles.length > 0) {
        console.log(`[sync] Skipped ${skippedFiles.length} file(s) due to processing errors`);
    }

    return {
        uploadedCount: toUpload.length,
        reusedCount: reused.length,
        skippedCount: skippedFiles.length,
        totalIdsInGallery: totalImages,
        sectionsCount: sections.length,
        sections: sections.map(s => ({ name: s.name, imageCount: s.attachments.length })),
        pageId: wpPageId,
        updated: !dryRun,
        images: {
            toUpload,
            reused,
            skipped: skippedFiles
        }
    };
}

module.exports = {
    syncOnce,
};

