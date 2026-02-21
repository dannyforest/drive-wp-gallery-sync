// src/cleanup.js
// Duplicate media cleanup functionality

const { createWp } = require('./wordpress');
const { env } = require('./utils');

/**
 * Extract all media IDs currently used in gallery blocks
 * Only called when FORCE_REUPLOAD=false
 * @param {string} content - WordPress page content (HTML/Gutenberg blocks)
 * @returns {Set<number>} Set of media IDs in use
 */
function extractMediaIdsFromContent(content) {
    const ids = new Set();

    // Match "id":123 in gallery blocks
    const idPattern = /"id":(\d+)/g;
    let match;
    while ((match = idPattern.exec(content)) !== null) {
        ids.add(parseInt(match[1], 10));
    }

    // Match class="wp-image-123" in image tags
    const classPattern = /class="[^"]*wp-image-(\d+)[^"]*"/g;
    while ((match = classPattern.exec(content)) !== null) {
        ids.add(parseInt(match[1], 10));
    }

    return ids;
}

/**
 * Group media files by their base filename (without -# suffix)
 * @param {Object} mediaCache - Media cache from WordPress { filename: { id, url } }
 * @returns {Object} Groups: { basename: [{ filename, id, url, isDuplicate, suffix }] }
 */
function groupMediaByBasename(mediaCache) {
    const groups = {};

    // Pattern to detect duplicates: /-(\d+)(\.[^.]+)$/
    // e.g., "photo-1.jpg" -> base: "photo.jpg", suffix: 1
    const duplicatePattern = /^(.+?)-(\d+)(\.[^.]+)$/;

    for (const [filename, data] of Object.entries(mediaCache)) {
        const match = filename.match(duplicatePattern);

        let basename, suffix;
        if (match) {
            // This is a duplicate (has -# suffix)
            basename = match[1] + match[3]; // e.g., "photo.jpg"
            suffix = parseInt(match[2], 10);
        } else {
            // This is an original (no -# suffix)
            basename = filename;
            suffix = null;
        }

        if (!groups[basename]) {
            groups[basename] = [];
        }

        groups[basename].push({
            filename,
            id: data.id,
            url: data.url,
            isDuplicate: suffix !== null,
            suffix
        });
    }

    return groups;
}

/**
 * Determine which media files should be deleted
 * @param {Object} groups - Grouped media by basename
 * @param {Set<number>} protectedIds - Media IDs currently in gallery (empty if forceReupload=true)
 * @param {boolean} forceReupload - Whether FORCE_REUPLOAD is enabled
 * @returns {Object} { toDelete: [...], toKeep: [...], reasons: {...} }
 */
function determineWhatToDelete(groups, protectedIds, forceReupload) {
    const toDelete = [];
    const toKeep = [];
    const reasons = {};

    for (const [basename, files] of Object.entries(groups)) {
        // Skip groups with only one file
        if (files.length === 1) {
            const file = files[0];
            toKeep.push(file);
            reasons[file.id] = 'only file in group';
            continue;
        }

        // Sort files: original first (suffix=null), then by suffix number
        files.sort((a, b) => {
            if (a.suffix === null && b.suffix === null) return 0;
            if (a.suffix === null) return -1;
            if (b.suffix === null) return 1;
            return a.suffix - b.suffix;
        });

        let kept = null;

        if (forceReupload) {
            // FORCE_REUPLOAD=true: prefer original filename, ignore gallery
            const original = files.find(f => f.suffix === null);
            if (original) {
                kept = original;
                reasons[original.id] = 'original filename';
            } else {
                // No original, keep highest suffix number
                kept = files[files.length - 1];
                reasons[kept.id] = `highest suffix (${kept.suffix})`;
            }
        } else {
            // FORCE_REUPLOAD=false: protect gallery references
            const inGallery = files.filter(f => protectedIds.has(f.id));

            if (inGallery.length > 0) {
                // Keep all files that are in the gallery
                for (const file of inGallery) {
                    toKeep.push(file);
                    reasons[file.id] = 'in gallery';
                }

                // Delete all files NOT in the gallery
                for (const file of files) {
                    if (!protectedIds.has(file.id)) {
                        toDelete.push(file);
                        const keptNames = inGallery.map(f => f.filename).join(', ');
                        reasons[file.id] = `duplicate, ${keptNames} in gallery`;
                    }
                }
                continue;
            }

            // None in gallery: prefer original filename
            const original = files.find(f => f.suffix === null);
            if (original) {
                kept = original;
                reasons[original.id] = 'original filename';
            } else {
                // No original, keep highest suffix number
                kept = files[files.length - 1];
                reasons[kept.id] = `highest suffix (${kept.suffix})`;
            }
        }

        // Mark kept file and delete the rest
        if (kept) {
            toKeep.push(kept);
            for (const file of files) {
                if (file.id !== kept.id) {
                    toDelete.push(file);
                    reasons[file.id] = `duplicate, keeping ${kept.filename}`;
                }
            }
        }
    }

    return { toDelete, toKeep, reasons };
}

/**
 * Main cleanup function - orchestrates the entire cleanup process
 * @param {Object} options - Cleanup options
 * @param {string} options.wpBaseUrl - WordPress base URL
 * @param {string} options.wpUser - WordPress username
 * @param {string} options.wpPass - WordPress app password
 * @param {number} options.wpPageId - WordPress page ID to check for gallery usage
 * @param {boolean} options.dryRun - If true, only report what would be deleted
 * @param {boolean} options.refreshCache - Whether to refresh WordPress media cache
 * @param {boolean} options.forceReupload - Whether FORCE_REUPLOAD is enabled (affects deletion strategy)
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupDuplicates(options) {
    const {
        wpBaseUrl,
        wpUser,
        wpPass,
        wpPageId,
        dryRun = true,
        refreshCache = false,
        forceReupload = false
    } = options;

    const delayMs = parseInt(env('CLEANUP_DELAY_MS', '100'), 10);

    console.log(`[cleanup] Starting duplicate cleanup ${dryRun ? '(DRY RUN)' : ''}`);
    console.log(`[cleanup] Mode: FORCE_REUPLOAD=${forceReupload} ${forceReupload ? '(ignoring gallery references, preferring original filenames)' : '(protecting gallery references)'}`);

    // Create WordPress client
    const wp = createWp(wpBaseUrl, wpUser, wpPass, { refreshCache });

    // Phase 1: Gather current gallery state (only if FORCE_REUPLOAD=false)
    let protectedIds = new Set();
    if (!forceReupload) {
        console.log(`[cleanup] Fetching page ${wpPageId} content...`);
        const page = await wp.getPage(wpPageId);
        const content = page.content?.rendered || '';
        protectedIds = extractMediaIdsFromContent(content);
        console.log(`[cleanup] Found ${protectedIds.size} media IDs in gallery blocks`);
    } else {
        console.log(`[cleanup] Skipping gallery content fetch (not needed in force reupload mode)`);
    }

    // Phase 2: Load all WordPress media
    console.log(`[cleanup] Loading WordPress media cache...`);
    await wp.loadMediaCache();
    const mediaCache = wp.getMediaCache();
    const totalMediaFiles = Object.keys(mediaCache).length;
    console.log(`[cleanup] Loaded ${totalMediaFiles} media files`);

    // Phase 3: Detect duplicates
    console.log(`[cleanup] Grouping media by basename...`);
    const groups = groupMediaByBasename(mediaCache);
    const totalGroups = Object.keys(groups).length;
    const groupsWithDuplicates = Object.values(groups).filter(g => g.length > 1).length;
    console.log(`[cleanup] Found ${totalGroups} unique basenames, ${groupsWithDuplicates} groups with duplicates`);

    // Phase 4: Determine what to delete
    console.log(`[cleanup] Analyzing duplicates...`);
    const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, forceReupload);

    // Log details for each duplicate group
    console.log(`[cleanup]`);
    for (const [basename, files] of Object.entries(groups)) {
        if (files.length > 1) {
            console.log(`[cleanup] Group: ${basename} (${files.length} files)`);
            for (const file of files) {
                const action = toDelete.find(f => f.id === file.id) ? 'DELETE' : 'KEEP';
                const symbol = action === 'KEEP' ? '✓' : '✗';
                const inGallery = protectedIds.has(file.id);
                const reason = reasons[file.id] || 'unknown';
                console.log(`[cleanup]   ${symbol} ${action.padEnd(6)} ${file.filename} (ID: ${file.id}) - ${reason}`);
            }
            console.log(`[cleanup]`);
        }
    }

    // Phase 5: Delete duplicates (if not dry run)
    const errors = [];
    let deletedCount = 0;

    if (!dryRun && toDelete.length > 0) {
        console.log(`[cleanup] Deleting ${toDelete.length} duplicate files...`);
        for (const file of toDelete) {
            try {
                await wp.deleteMedia(file.id, true);
                deletedCount++;
                console.log(`[cleanup] Deleted ${file.filename} (ID: ${file.id})`);

                // Delay between deletions to avoid overwhelming WordPress
                if (delayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            } catch (err) {
                const errorMsg = err.message || String(err);
                errors.push({ filename: file.filename, id: file.id, error: errorMsg });
                console.error(`[cleanup] Failed to delete ${file.filename} (ID: ${file.id}): ${errorMsg}`);
            }
        }
    }

    // Summary
    console.log(`[cleanup] Summary:`);
    console.log(`[cleanup]   Total media files: ${totalMediaFiles}`);
    console.log(`[cleanup]   Groups with duplicates: ${groupsWithDuplicates}`);
    console.log(`[cleanup]   Files to delete: ${toDelete.length}`);
    console.log(`[cleanup]   Files to keep: ${toKeep.length}`);
    console.log(`[cleanup]   Protected (in gallery): ${protectedIds.size}${forceReupload ? ' (force reupload mode)' : ''}`);

    if (dryRun) {
        console.log(`[cleanup]`);
        console.log(`[cleanup] DRY RUN - No files were deleted`);
        console.log(`[cleanup] Run with dryRun=false to actually delete files`);
        if (forceReupload) {
            console.log(`[cleanup] Note: Next sync will re-upload all images with clean filenames`);
        }
    } else {
        console.log(`[cleanup]   Deleted: ${deletedCount}`);
        if (errors.length > 0) {
            console.log(`[cleanup]   Errors: ${errors.length}`);
        }
    }

    // Build duplicate groups for response
    const duplicateGroups = [];
    for (const [basename, files] of Object.entries(groups)) {
        if (files.length > 1) {
            duplicateGroups.push({
                basename,
                files: files.map(f => ({
                    filename: f.filename,
                    id: f.id,
                    inGallery: protectedIds.has(f.id),
                    action: toDelete.find(d => d.id === f.id) ? 'delete' : 'keep',
                    reason: reasons[f.id] || 'unknown'
                }))
            });
        }
    }

    return {
        mode: 'cleanup',
        dryRun,
        pageId: wpPageId,
        forceReupload,
        totalMediaFiles,
        totalGroups,
        groupsWithDuplicates,
        protectedMediaIds: protectedIds.size,
        toDeleteCount: toDelete.length,
        toKeepCount: toKeep.length,
        deletedCount,
        duplicateGroups,
        errors
    };
}

module.exports = {
    extractMediaIdsFromContent,
    groupMediaByBasename,
    determineWhatToDelete,
    cleanupDuplicates
};

