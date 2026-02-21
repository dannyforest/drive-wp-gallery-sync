# Spec: WordPress Duplicate Media Cleanup Feature

## Overview
Add functionality to detect and delete duplicate WordPress media files that have WordPress-generated `-#` suffixes (e.g., `photo-1.jpg`, `photo-2.jpg`) while ensuring the media kept is the one currently used in the gallery.

## Problem Statement
When files are uploaded to WordPress multiple times, WordPress automatically appends `-1`, `-2`, `-3`, etc. to prevent filename conflicts. This results in:
- Duplicate media files in WordPress Media Library
- Wasted storage space
- Confusion about which file is "correct"
- **Critical**: Need to ensure we keep the media ID that's actually referenced in the gallery blocks

## Key Insight: Gallery Uses Media IDs
The WordPress gallery blocks reference media by **ID**, not filename:
```html
<!-- wp:image {"id":123,"sizeSlug":"large"...} -->
<img src="..." alt="..." class="wp-image-123"/>
```

**Therefore**:
- **If `FORCE_REUPLOAD=false` (default)**: We must keep the media file whose ID is currently used in the gallery, regardless of whether it has a `-#` suffix or not. The sync process reuses existing media, so the gallery references are stable.
- **If `FORCE_REUPLOAD=true`**: The gallery will be completely rebuilt with new media IDs on next sync, so we can be more aggressive and simply keep the original filename (without `-#` suffix) and delete all duplicates. The next sync will re-upload and update all gallery references anyway.

## Solution Architecture

### Integration Point
- **Location**: `index.js` Lambda handler
- **Trigger**: New query parameter `cleanupDuplicates=true`
- **Mode**: Runs instead of sync when cleanup mode is enabled

### Workflow

#### Phase 1: Gather Current Gallery State (Only if `FORCE_REUPLOAD=false`)
1. Fetch the WordPress page content (using `wp.getPage(wpPageId)`)
2. Parse all gallery blocks to extract **currently used media IDs**
3. Build a Set of "protected" media IDs that are in use
4. **If `FORCE_REUPLOAD=true`**: Skip this phase, use empty protected set (nothing is protected)

#### Phase 2: Load All WordPress Media
1. Use existing `wp.loadMediaCache()` to fetch all media
2. Get full media list with IDs, filenames, and URLs

#### Phase 3: Detect Duplicates
1. Group media files by base filename (stripping `-#` suffix)
2. For each group with multiple files:
   - Identify which file has the "original" name (no `-#` suffix)
   - Identify which files have `-#` suffixes
   - **Check which media ID is in the protected set** (currently in gallery)

#### Phase 4: Determine What to Delete
For each duplicate group:

**If `FORCE_REUPLOAD=false` (default - gallery references are stable):**
- **If a media ID from this group is in the gallery**: Keep that one, delete all others
- **If NO media ID from this group is in the gallery**: Keep the original (no suffix), delete `-#` versions
- **If only `-#` versions exist and none in gallery**: Keep the highest number (e.g., keep `-3`, delete `-2`, `-1`)

**If `FORCE_REUPLOAD=true` (gallery will be rebuilt on next sync):**
- **Always keep the original** (no `-#` suffix) if it exists, delete all `-#` versions
- **If only `-#` versions exist**: Keep the highest number (e.g., keep `-3`, delete `-2`, `-1`)
- **Ignore gallery references** since they'll be replaced on next sync anyway

#### Phase 5: Delete Duplicates
1. Use WordPress REST API `DELETE /wp/v2/media/{id}?force=true`
2. Track successes and failures
3. Update cache after deletions

### Safety Mechanisms

1. **Default Dry Run**: Always default to `dryRun=true`
2. **Gallery Protection** (when `FORCE_REUPLOAD=false`): Never delete media currently used in the gallery
3. **Orphan Protection**: If no original exists, keep one duplicate (lowest suffix number)
4. **Comprehensive Logging**: Log every decision (keep/delete) with reasoning
5. **Error Handling**: Continue on individual deletion failures, report all errors at end
6. **Force Reupload Awareness**: Behavior adapts based on `FORCE_REUPLOAD` setting

## File Changes

### New Files
- `src/cleanup.js` - Duplicate detection and cleanup logic

### Modified Files
- `src/wordpress.js` - Add `deleteMedia()` and `getMediaCache()` methods
- `index.js` - Add cleanup mode to Lambda handler
- `config.js` - Add `CLEANUP_DUPLICATES` configuration option
- `src/sync.js` - Export helper to extract media IDs from page content (optional)

## API Design

### New WordPress Client Methods

#### `deleteMedia(mediaId, force = true)`
```javascript
/**
 * Delete media from WordPress
 * @param {number} mediaId - WordPress media ID
 * @param {boolean} force - If true, permanently delete; if false, move to trash
 * @returns {Promise<Object>} Deletion response
 */
```

#### `getMediaCache()`
```javascript
/**
 * Get the current media cache
 * @returns {Object} Media cache object { filename: { id, url } }
 */
```

### New Cleanup Module (`src/cleanup.js`)

#### `extractMediaIdsFromContent(content)`
```javascript
/**
 * Extract all media IDs currently used in gallery blocks
 * Only called when FORCE_REUPLOAD=false
 * @param {string} content - WordPress page content (HTML/Gutenberg blocks)
 * @returns {Set<number>} Set of media IDs in use
 */
```

Regex patterns to match:
- `"id":(\d+)` in gallery blocks
- `class="wp-image-(\d+)"` in image tags

#### `groupMediaByBasename(mediaCache)`
```javascript
/**
 * Group media files by their base filename (without -# suffix)
 * @param {Object} mediaCache - Media cache from WordPress
 * @returns {Object} Groups: { basename: [{ filename, id, url, isDuplicate, suffix }] }
 */
```

Pattern to detect duplicates: `/-(\d+)(\.[^.]+)$/`
- `photo-1.jpg` → base: `photo.jpg`, suffix: `1`
- `photo.jpg` → base: `photo.jpg`, suffix: `null`

#### `determineWhatToDelete(groups, protectedIds, forceReupload)`
```javascript
/**
 * Determine which media files should be deleted
 * @param {Object} groups - Grouped media by basename
 * @param {Set<number>} protectedIds - Media IDs currently in gallery (empty if forceReupload=true)
 * @param {boolean} forceReupload - Whether FORCE_REUPLOAD is enabled
 * @returns {Object} { toDelete: [...], toKeep: [...], reasons: {...} }
 */
```

Decision logic when `forceReupload=false`:
1. For each group, check if any ID is in `protectedIds`
2. If yes: keep that one, delete all others in group
3. If no: keep original (no suffix), delete all `-#` versions
4. If no original: keep lowest suffix number, delete rest

Decision logic when `forceReupload=true`:
1. For each group, keep original (no suffix) if it exists
2. Delete all `-#` versions
3. If no original: keep lowest suffix number, delete rest
4. Ignore `protectedIds` (will be empty anyway)

#### `cleanupDuplicates(options)`
```javascript
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
```

## Configuration

### config.js Addition
Add new configuration option:
```javascript
// Whether to run cleanup mode to delete duplicate media files
CLEANUP_DUPLICATES: false,
```

### Lambda Handler Integration

### New Parameter
- `cleanupDuplicates` (boolean, default: `false`)
  - **Query string**: `?cleanupDuplicates=true`
  - **Request body**: `{ "cleanupDuplicates": true }`
  - **Environment variable**: `CLEANUP_DUPLICATES=true`
  - **Config file**: `CLEANUP_DUPLICATES: true` in `config.js`

Priority order (same as other parameters):
1. Query string parameter
2. Request body parameter
3. Environment variable
4. Config file value
5. Default (`false`)

### Handler Logic
```javascript
// In index.js handler
const { CLEANUP_DUPLICATES } = require('./config');

const cleanupDuplicates = parseBool(
  qs.cleanupDuplicates ?? body.cleanupDuplicates ?? env('CLEANUP_DUPLICATES') ?? CLEANUP_DUPLICATES,
  false
);

if (cleanupDuplicates) {
  const { cleanupDuplicates: cleanupFn } = require('./src/cleanup');
  const result = await cleanupFn({
    wpBaseUrl,
    wpUser,
    wpPass,
    wpPageId,
    dryRun,
    refreshCache,
    forceReupload  // Pass FORCE_REUPLOAD setting to cleanup
  });
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, result })
  };
}

// Otherwise, continue with normal sync...
```

## Return Value Structure

### Cleanup Result Object
```javascript
{
  ok: true,
  result: {
    mode: 'cleanup',
    dryRun: true,
    pageId: 123,

    // Summary counts
    totalMediaFiles: 450,
    totalGroups: 380,
    groupsWithDuplicates: 25,
    protectedMediaIds: 120,  // IDs currently in gallery

    // Actions
    toDeleteCount: 32,
    toKeepCount: 418,
    deletedCount: 0,  // (0 if dryRun, actual count otherwise)

    // Details
    duplicateGroups: [
      {
        basename: 'photo.jpg',
        files: [
          { filename: 'photo.jpg', id: 100, inGallery: true, action: 'keep', reason: 'in gallery' },
          { filename: 'photo-1.jpg', id: 101, inGallery: false, action: 'delete', reason: 'duplicate, original in gallery' },
          { filename: 'photo-2.jpg', id: 102, inGallery: false, action: 'delete', reason: 'duplicate, original in gallery' }
        ]
      },
      {
        basename: 'sunset.jpg',
        files: [
          { filename: 'sunset-1.jpg', id: 200, inGallery: true, action: 'keep', reason: 'in gallery' },
          { filename: 'sunset-2.jpg', id: 201, inGallery: false, action: 'delete', reason: 'duplicate, sunset-1 in gallery' }
        ]
      }
    ],

    // Errors (if any)
    errors: [
      { filename: 'photo-3.jpg', id: 103, error: 'Permission denied' }
    ]
  }
}
```

## Edge Cases & Handling

### Case 1: Duplicate in Gallery, Original Not
**Example**: `photo-1.jpg` (ID: 101) is in gallery, `photo.jpg` (ID: 100) exists but not in gallery
- **Action**: Keep `photo-1.jpg`, delete `photo.jpg`
- **Reason**: Gallery reference takes priority

### Case 2: Multiple Duplicates, None in Gallery
**Example**: `photo.jpg`, `photo-1.jpg`, `photo-2.jpg` exist, none in gallery
- **Action**: Keep `photo.jpg`, delete `-1` and `-2`
- **Reason**: Prefer original filename

### Case 3: Only Duplicates Exist, None in Gallery
**Example**: `photo-1.jpg`, `photo-2.jpg`, `photo-3.jpg` exist, no `photo.jpg`, none in gallery
- **Action**: Keep `photo-3.jpg`, delete `-2` and `-1`
- **Reason**: Keep lowest suffix number

### Case 4: Multiple Files in Same Group, Multiple in Gallery (FORCE_REUPLOAD=false)
**Example**: Both `photo.jpg` (ID: 100) and `photo-1.jpg` (ID: 101) are in gallery
- **Action**: Keep both, delete only `photo-2.jpg`, `photo-3.jpg`, etc.
- **Reason**: Never delete anything currently in use

### Case 6: FORCE_REUPLOAD=true Mode
**Example**: `photo.jpg` (ID: 100) in gallery, `photo-1.jpg` (ID: 101) and `photo-2.jpg` (ID: 102) exist
- **Action**: Keep `photo.jpg`, delete `photo-1.jpg` and `photo-2.jpg` (even though 100 is in gallery)
- **Reason**: Next sync will re-upload everything anyway, so prefer clean filenames

### Case 5: Folder-Prefixed Filenames
**Example**: `Summer-photo.jpg`, `Summer-photo-1.jpg`
- **Action**: Treat as duplicates of same base
- **Reason**: WordPress adds `-#` after the full filename including folder prefix

## Testing Strategy

### Unit Tests (`src/cleanup.test.js`)
1. `extractMediaIdsFromContent()` - Test regex extraction from various block formats
2. `groupMediaByBasename()` - Test grouping logic with various filename patterns
3. `determineWhatToDelete()` - Test decision logic for all edge cases

### Integration Tests
1. Mock WordPress API with sample media library
2. Mock page content with gallery blocks
3. Verify correct files are marked for deletion
4. Verify protected files are never deleted

### Manual Testing Checklist
- [ ] Dry run on production data
- [ ] Verify all gallery images are in protected set
- [ ] Review deletion list for false positives
- [ ] Test actual deletion on staging environment
- [ ] Verify gallery still works after cleanup
- [ ] Verify cache is updated correctly

## Logging Strategy

### Console Output Format

**When FORCE_REUPLOAD=false:**
```
[cleanup] Starting duplicate cleanup (DRY RUN)
[cleanup] Mode: FORCE_REUPLOAD=false (protecting gallery references)
[cleanup] Fetching page 123 content...
[cleanup] Found 120 media IDs in gallery blocks
[cleanup] Loading WordPress media cache...
[cleanup] Loaded 450 media files
[cleanup] Grouping media by basename...
[cleanup] Found 380 unique basenames, 25 groups with duplicates
[cleanup] Analyzing duplicates...
[cleanup]
[cleanup] Group: photo.jpg (3 files)
[cleanup]   ✓ KEEP   photo.jpg (ID: 100) - in gallery
[cleanup]   ✗ DELETE photo-1.jpg (ID: 101) - duplicate, original in gallery
[cleanup]   ✗ DELETE photo-2.jpg (ID: 102) - duplicate, original in gallery
[cleanup]
[cleanup] Group: sunset.jpg (2 files)
[cleanup]   ✓ KEEP   sunset-1.jpg (ID: 200) - in gallery
[cleanup]   ✗ DELETE sunset-2.jpg (ID: 201) - duplicate, sunset-1 in gallery
[cleanup]
[cleanup] Summary:
[cleanup]   Total media files: 450
[cleanup]   Groups with duplicates: 25
[cleanup]   Files to delete: 32
[cleanup]   Files to keep: 418
[cleanup]   Protected (in gallery): 120
[cleanup]
[cleanup] DRY RUN - No files were deleted
[cleanup] Run with dryRun=false to actually delete files
```

**When FORCE_REUPLOAD=true:**
```
[cleanup] Starting duplicate cleanup (DRY RUN)
[cleanup] Mode: FORCE_REUPLOAD=true (ignoring gallery references, preferring original filenames)
[cleanup] Skipping gallery content fetch (not needed in force reupload mode)
[cleanup] Loading WordPress media cache...
[cleanup] Loaded 450 media files
[cleanup] Grouping media by basename...
[cleanup] Found 380 unique basenames, 25 groups with duplicates
[cleanup] Analyzing duplicates...
[cleanup]
[cleanup] Group: photo.jpg (3 files)
[cleanup]   ✓ KEEP   photo.jpg (ID: 100) - original filename
[cleanup]   ✗ DELETE photo-1.jpg (ID: 101) - duplicate, keeping original
[cleanup]   ✗ DELETE photo-2.jpg (ID: 102) - duplicate, keeping original
[cleanup]
[cleanup] Summary:
[cleanup]   Total media files: 450
[cleanup]   Groups with duplicates: 25
[cleanup]   Files to delete: 32
[cleanup]   Files to keep: 418
[cleanup]   Protected (in gallery): 0 (force reupload mode)
[cleanup]
[cleanup] DRY RUN - No files were deleted
[cleanup] Run with dryRun=false to actually delete files
[cleanup] Note: Next sync will re-upload all images with clean filenames
```

## Security & Permissions

### Required WordPress Permissions
- Read access to pages (to fetch gallery content)
- Read access to media library (to list all media)
- Delete access to media (to remove duplicates)

### Authentication
- Uses existing WordPress REST API authentication (Basic Auth with app password)
- Same credentials as sync operation

### Rate Limiting
- Deletion operations should be throttled to avoid overwhelming WordPress
- Suggested: 100ms delay between deletions
- Configurable via `CLEANUP_DELAY_MS` environment variable

## Configuration Options

### config.js
```javascript
// In config.js
module.exports = {
  // ... existing config ...

  // Whether to run cleanup mode to delete duplicate media files
  CLEANUP_DUPLICATES: false,

  // Delay between deletions in milliseconds (to avoid overwhelming WordPress)
  CLEANUP_DELAY_MS: 100,
};
```

### Environment Variables
```bash
# Existing variables (reused)
WP_BASE_URL=https://example.com
WP_USERNAME=admin
WP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
WP_PAGE_ID=123

# New variables (override config.js)
CLEANUP_DUPLICATES=false  # Enable cleanup mode
CLEANUP_DELAY_MS=100      # Delay between deletions (ms)
```

### Query String Parameters
All configuration can be overridden via query string:
```
?cleanupDuplicates=true&dryRun=true&pageId=123&forceReupload=false
```

### Usage Examples

#### Method 1: Via config.js (Persistent)
```javascript
// In config.js
module.exports = {
  CLEANUP_DUPLICATES: true,
  DRY_RUN: true,  // Start with dry run
  // ... other config
};
```
Then invoke Lambda normally (no query params needed).

#### Method 2: Via Environment Variables
```bash
# Set in Lambda environment or .env file
CLEANUP_DUPLICATES=true
DRY_RUN=true
```

#### Method 3: Via Query String (One-time override)
```bash
# Dry Run (Preview)
curl "https://lambda-url?cleanupDuplicates=true&dryRun=true&pageId=123"

# Actual Cleanup
curl "https://lambda-url?cleanupDuplicates=true&dryRun=false&pageId=123"

# With force reupload mode
curl "https://lambda-url?cleanupDuplicates=true&dryRun=false&pageId=123&forceReupload=true"
```

#### Method 4: Via Request Body
```bash
# Via AWS CLI
aws lambda invoke \
  --function-name drive-wp-sync \
  --payload '{"cleanupDuplicates":true,"dryRun":true,"pageId":123}' \
  response.json

# Via curl with JSON body
curl -X POST "https://lambda-url" \
  -H "Content-Type: application/json" \
  -d '{"cleanupDuplicates":true,"dryRun":false,"pageId":123}'
```

#### Recommended Workflow
1. **First**: Dry run via query string to preview
   ```bash
   curl "https://lambda-url?cleanupDuplicates=true&dryRun=true&pageId=123"
   ```
2. **Review**: Check the response to see what would be deleted
3. **Execute**: Run actual cleanup
   ```bash
   curl "https://lambda-url?cleanupDuplicates=true&dryRun=false&pageId=123"
   ```
4. **Verify**: Check gallery still works correctly

## Success Criteria

1. ✅ All media currently in gallery is preserved (when `FORCE_REUPLOAD=false`)
2. ✅ Duplicate files with `-#` suffix are identified correctly
3. ✅ Only safe-to-delete files are removed
4. ✅ Gallery continues to work after cleanup (when `FORCE_REUPLOAD=false`)
5. ✅ Comprehensive logging shows all decisions and current mode
6. ✅ Dry run mode allows safe preview
7. ✅ Error handling prevents partial failures from breaking the process
8. ✅ Cache is updated to reflect deletions
9. ✅ Behavior correctly adapts based on `FORCE_REUPLOAD` setting
10. ✅ When `FORCE_REUPLOAD=true`, prefers original filenames over gallery protection

## Future Enhancements (Out of Scope)

- Cleanup across multiple pages
- Cleanup of media not used anywhere (orphaned media)
- Automatic cleanup after sync operation
- Batch deletion with progress reporting
- Undo/rollback capability

