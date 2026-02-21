// src/cleanup.test.js
const {
    extractMediaIdsFromContent,
    groupMediaByBasename,
    determineWhatToDelete,
    cleanupDuplicates
} = require('./cleanup');

// ---------- extractMediaIdsFromContent ----------
describe('extractMediaIdsFromContent', () => {
    it('extracts media IDs from gallery blocks', () => {
        const content = `
            <!-- wp:image {"id":123} -->
            <!-- wp:image {"id":456} -->
            <!-- wp:image {"id":789} -->
            <figure class="wp-block-gallery">
                <ul class="blocks-gallery-grid">
                    <li class="blocks-gallery-item">
                        <figure><img src="..." data-id="123" class="wp-image-123"/></figure>
                    </li>
                </ul>
            </figure>
            <!-- /wp:gallery -->
        `;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.has(123)).toBe(true);
        expect(ids.has(456)).toBe(true);
        expect(ids.has(789)).toBe(true);
    });

    it('extracts media IDs from image blocks with "id" property', () => {
        const content = `<!-- wp:image {"id":100,"sizeSlug":"large"} -->`;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.has(100)).toBe(true);
    });

    it('extracts media IDs from wp-image class names', () => {
        const content = `<img src="..." alt="..." class="wp-image-200"/>`;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.has(200)).toBe(true);
    });

    it('extracts multiple IDs from mixed content', () => {
        const content = `
            <!-- wp:image {"id":100} -->
            <img class="wp-image-100"/>
            <!-- wp:image {"id":200} -->
            <img class="wp-image-200"/>
            <img class="wp-image-300"/>
        `;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.size).toBe(3);
        expect(ids.has(100)).toBe(true);
        expect(ids.has(200)).toBe(true);
        expect(ids.has(300)).toBe(true);
    });

    it('returns empty set for content without media IDs', () => {
        const content = `<p>Just some text</p>`;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.size).toBe(0);
    });

    it('handles duplicate IDs (only stores once in Set)', () => {
        const content = `
            <!-- wp:image {"id":100} -->
            <img class="wp-image-100"/>
            <!-- wp:image {"id":100} -->
        `;
        const ids = extractMediaIdsFromContent(content);
        expect(ids.size).toBe(1);
        expect(ids.has(100)).toBe(true);
    });
});

// ---------- groupMediaByBasename ----------
describe('groupMediaByBasename', () => {
    it('groups files with -# suffix under same basename', () => {
        const mediaCache = {
            'photo.jpg': { id: 100, url: 'http://example.com/photo.jpg' },
            'photo-1.jpg': { id: 101, url: 'http://example.com/photo-1.jpg' },
            'photo-2.jpg': { id: 102, url: 'http://example.com/photo-2.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        expect(groups['photo.jpg']).toBeDefined();
        expect(groups['photo.jpg'].length).toBe(3);
        expect(groups['photo.jpg'].map(f => f.filename)).toEqual(['photo.jpg', 'photo-1.jpg', 'photo-2.jpg']);
    });

    it('identifies original files (no suffix)', () => {
        const mediaCache = {
            'photo.jpg': { id: 100, url: 'http://example.com/photo.jpg' },
            'photo-1.jpg': { id: 101, url: 'http://example.com/photo-1.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        const original = groups['photo.jpg'].find(f => f.filename === 'photo.jpg');
        const duplicate = groups['photo.jpg'].find(f => f.filename === 'photo-1.jpg');

        expect(original.isDuplicate).toBe(false);
        expect(original.suffix).toBe(null);
        expect(duplicate.isDuplicate).toBe(true);
        expect(duplicate.suffix).toBe(1);
    });

    it('handles files with only duplicates (no original)', () => {
        const mediaCache = {
            'photo-1.jpg': { id: 101, url: 'http://example.com/photo-1.jpg' },
            'photo-2.jpg': { id: 102, url: 'http://example.com/photo-2.jpg' },
            'photo-3.jpg': { id: 103, url: 'http://example.com/photo-3.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        expect(groups['photo.jpg']).toBeDefined();
        expect(groups['photo.jpg'].length).toBe(3);
        expect(groups['photo.jpg'].every(f => f.isDuplicate)).toBe(true);
    });

    it('handles folder-prefixed filenames', () => {
        const mediaCache = {
            'summer-photo.jpg': { id: 100, url: 'http://example.com/summer-photo.jpg' },
            'summer-photo-1.jpg': { id: 101, url: 'http://example.com/summer-photo-1.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        expect(groups['summer-photo.jpg']).toBeDefined();
        expect(groups['summer-photo.jpg'].length).toBe(2);
    });

    it('keeps single files in their own group', () => {
        const mediaCache = {
            'unique.jpg': { id: 100, url: 'http://example.com/unique.jpg' },
            'another.jpg': { id: 200, url: 'http://example.com/another.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        expect(groups['unique.jpg'].length).toBe(1);
        expect(groups['another.jpg'].length).toBe(1);
    });

    it('handles different file extensions', () => {
        const mediaCache = {
            'photo.png': { id: 100, url: 'http://example.com/photo.png' },
            'photo-1.png': { id: 101, url: 'http://example.com/photo-1.png' },
            'photo.jpg': { id: 200, url: 'http://example.com/photo.jpg' }
        };
        const groups = groupMediaByBasename(mediaCache);

        // Different extensions should be in different groups
        expect(groups['photo.png'].length).toBe(2);
        expect(groups['photo.jpg'].length).toBe(1);
    });
});

// ---------- determineWhatToDelete ----------
describe('determineWhatToDelete', () => {
    describe('FORCE_REUPLOAD=false (protect gallery references)', () => {
        it('keeps file in gallery, deletes duplicates', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 },
                    { filename: 'photo-2.jpg', id: 102, isDuplicate: true, suffix: 2 }
                ]
            };
            const protectedIds = new Set([100]);
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([100]);
            expect(toDelete.map(f => f.id)).toEqual([101, 102]);
            expect(reasons[100]).toBe('in gallery');
        });

        it('keeps duplicate in gallery, deletes original', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 }
                ]
            };
            const protectedIds = new Set([101]);
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([101]);
            expect(toDelete.map(f => f.id)).toEqual([100]);
            expect(reasons[101]).toBe('in gallery');
        });

        it('keeps multiple files if both in gallery', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 },
                    { filename: 'photo-2.jpg', id: 102, isDuplicate: true, suffix: 2 }
                ]
            };
            const protectedIds = new Set([100, 101]);
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([100, 101]);
            expect(toDelete.map(f => f.id)).toEqual([102]);
            expect(reasons[100]).toBe('in gallery');
            expect(reasons[101]).toBe('in gallery');
        });

        it('keeps original when none in gallery', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 }
                ]
            };
            const protectedIds = new Set();
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([100]);
            expect(toDelete.map(f => f.id)).toEqual([101]);
            expect(reasons[100]).toBe('original filename');
        });

        it('keeps highest suffix when no original and none in gallery', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 },
                    { filename: 'photo-2.jpg', id: 102, isDuplicate: true, suffix: 2 },
                    { filename: 'photo-3.jpg', id: 103, isDuplicate: true, suffix: 3 }
                ]
            };
            const protectedIds = new Set();
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([103]);
            expect(toDelete.map(f => f.id)).toEqual([101, 102]);
            expect(reasons[103]).toContain('highest suffix');
        });

        it('keeps single file in group', () => {
            const groups = {
                'unique.jpg': [
                    { filename: 'unique.jpg', id: 100, isDuplicate: false, suffix: null }
                ]
            };
            const protectedIds = new Set();
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, false);

            expect(toKeep.map(f => f.id)).toEqual([100]);
            expect(toDelete.length).toBe(0);
            expect(reasons[100]).toBe('only file in group');
        });
    });

    describe('FORCE_REUPLOAD=true (prefer original filenames)', () => {
        it('keeps original, deletes all duplicates (ignores gallery)', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 },
                    { filename: 'photo-2.jpg', id: 102, isDuplicate: true, suffix: 2 }
                ]
            };
            const protectedIds = new Set([101]); // 101 is in gallery but should be ignored
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, true);

            expect(toKeep.map(f => f.id)).toEqual([100]);
            expect(toDelete.map(f => f.id)).toEqual([101, 102]);
            expect(reasons[100]).toBe('original filename');
        });

        it('keeps highest suffix when no original', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 },
                    { filename: 'photo-2.jpg', id: 102, isDuplicate: true, suffix: 2 },
                    { filename: 'photo-3.jpg', id: 103, isDuplicate: true, suffix: 3 }
                ]
            };
            const protectedIds = new Set([101]);
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, true);

            expect(toKeep.map(f => f.id)).toEqual([103]);
            expect(toDelete.map(f => f.id)).toEqual([101, 102]);
            expect(reasons[103]).toContain('highest suffix');
        });

        it('ignores protected IDs completely', () => {
            const groups = {
                'photo.jpg': [
                    { filename: 'photo.jpg', id: 100, isDuplicate: false, suffix: null },
                    { filename: 'photo-1.jpg', id: 101, isDuplicate: true, suffix: 1 }
                ]
            };
            const protectedIds = new Set([100, 101]); // Both protected but should be ignored
            const { toDelete, toKeep, reasons } = determineWhatToDelete(groups, protectedIds, true);

            expect(toKeep.map(f => f.id)).toEqual([100]);
            expect(toDelete.map(f => f.id)).toEqual([101]);
            expect(reasons[100]).toBe('original filename');
        });
    });
});

// ---------- cleanupDuplicates ----------
describe('cleanupDuplicates', () => {
    it('is exported and is a function', () => {
        expect(cleanupDuplicates).toBeDefined();
        expect(typeof cleanupDuplicates).toBe('function');
    });

    // Note: Full integration tests would require mocking the WordPress API
    // The function is tested indirectly through the unit tests above
    // and can be tested manually using local.js with CLEANUP_DUPLICATES=true
});

