// index.test.js
const {
    env,
    parseBool,
    pickOrder,
    stripExt,
    makeUniqueFilename,
    basicAuthHeader,
    makeAnchorId,
    makeGalleryBlock,
    makeHeadingBlock,
    makeSpacerBlock,
    makeTocBlock,
    makeMasonryStyles,
    makeSectionContent,
    makePageContent,
    isCacheValid,
} = require('./index');

// ---------- env ----------
describe('env', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns environment variable value when set', () => {
        process.env.TEST_VAR = 'hello';
        expect(env('TEST_VAR')).toBe('hello');
    });

    it('returns fallback when env var is undefined', () => {
        delete process.env.TEST_VAR;
        expect(env('TEST_VAR', 'default')).toBe('default');
    });

    it('returns fallback when env var is empty string', () => {
        process.env.TEST_VAR = '';
        expect(env('TEST_VAR', 'default')).toBe('default');
    });

    it('returns undefined fallback when not provided', () => {
        delete process.env.TEST_VAR;
        expect(env('TEST_VAR')).toBeUndefined();
    });
});

// ---------- parseBool ----------
describe('parseBool', () => {
    it('returns true for "true" string', () => {
        expect(parseBool('true')).toBe(true);
    });

    it('returns true for "TRUE" string (case insensitive)', () => {
        expect(parseBool('TRUE')).toBe(true);
    });

    it('returns false for "false" string', () => {
        expect(parseBool('false')).toBe(false);
    });

    it('returns false for other strings', () => {
        expect(parseBool('yes')).toBe(false);
        expect(parseBool('1')).toBe(false);
    });

    it('returns default when undefined', () => {
        expect(parseBool(undefined, true)).toBe(true);
        expect(parseBool(undefined, false)).toBe(false);
    });

    it('returns default when null', () => {
        expect(parseBool(null, true)).toBe(true);
    });
});

// ---------- pickOrder ----------
describe('pickOrder', () => {
    const items = [
        { name: 'banana', modifiedTime: '2024-01-02T00:00:00Z' },
        { name: 'apple', modifiedTime: '2024-01-03T00:00:00Z' },
        { name: 'cherry', modifiedTime: '2024-01-01T00:00:00Z' },
    ];

    it('sorts by name ascending', () => {
        const sorted = [...items].sort(pickOrder('name_asc'));
        expect(sorted.map(i => i.name)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('sorts by name descending', () => {
        const sorted = [...items].sort(pickOrder('name_desc'));
        expect(sorted.map(i => i.name)).toEqual(['cherry', 'banana', 'apple']);
    });

    it('sorts by modified time descending', () => {
        const sorted = [...items].sort(pickOrder('modified_desc'));
        expect(sorted.map(i => i.name)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('sorts by modified time ascending', () => {
        const sorted = [...items].sort(pickOrder('modified_asc'));
        expect(sorted.map(i => i.name)).toEqual(['cherry', 'banana', 'apple']);
    });

    it('defaults to name ascending for unknown order', () => {
        const sorted = [...items].sort(pickOrder('unknown'));
        expect(sorted.map(i => i.name)).toEqual(['apple', 'banana', 'cherry']);
    });
});

// ---------- stripExt ----------
describe('stripExt', () => {
    it('removes file extension', () => {
        expect(stripExt('photo.jpg')).toBe('photo');
    });

    it('removes only last extension', () => {
        expect(stripExt('photo.backup.jpg')).toBe('photo.backup');
    });

    it('handles files without extension', () => {
        expect(stripExt('photo')).toBe('photo');
    });

    it('handles hidden files', () => {
        expect(stripExt('.gitignore')).toBe('');
    });
});

// ---------- basicAuthHeader ----------
describe('basicAuthHeader', () => {
    it('creates valid basic auth header', () => {
        const header = basicAuthHeader('user', 'pass');
        expect(header).toBe('Basic ' + Buffer.from('user:pass').toString('base64'));
    });

    it('handles special characters', () => {
        const header = basicAuthHeader('user@domain.com', 'p@ss:word');
        const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString();
        expect(decoded).toBe('user@domain.com:p@ss:word');
    });
});

// ---------- makeAnchorId ----------
describe('makeAnchorId', () => {
    it('converts text to lowercase', () => {
        expect(makeAnchorId('Hello World')).toBe('hello-world');
    });

    it('replaces non-alphanumeric with hyphens', () => {
        expect(makeAnchorId('Photo & Video!')).toBe('photo-video');
    });

    it('removes leading and trailing hyphens', () => {
        expect(makeAnchorId('--test--')).toBe('test');
    });

    it('handles accented characters', () => {
        expect(makeAnchorId('Café Résumé')).toBe('caf-r-sum');
    });
});

// ---------- makeHeadingBlock ----------
describe('makeHeadingBlock', () => {
    it('creates heading with default level 2', () => {
        const block = makeHeadingBlock('Test Title');
        expect(block).toContain('wp:heading');
        expect(block).toContain('"level":2');
        expect(block).toContain('<h2');
        expect(block).toContain('Test Title');
    });

    it('creates heading with custom level', () => {
        const block = makeHeadingBlock('Test Title', 3);
        expect(block).toContain('"level":3');
        expect(block).toContain('<h3');
    });

    it('includes anchor when provided', () => {
        const block = makeHeadingBlock('Test Title', 2, 'test-anchor');
        expect(block).toContain('"anchor":"test-anchor"');
        expect(block).toContain('id="test-anchor"');
    });
});

// ---------- makeSpacerBlock ----------
describe('makeSpacerBlock', () => {
    it('creates spacer with default height', () => {
        const block = makeSpacerBlock();
        expect(block).toContain('wp:spacer');
        expect(block).toContain('"height":"50px"');
        expect(block).toContain('style="height:50px"');
    });

    it('creates spacer with custom height', () => {
        const block = makeSpacerBlock(100);
        expect(block).toContain('"height":"100px"');
        expect(block).toContain('style="height:100px"');
    });
});

// ---------- makeGalleryBlock ----------
describe('makeGalleryBlock', () => {
    it('creates gallery block with images', () => {
        const attachments = [
            { id: 1, url: 'http://example.com/img1.jpg', alt: 'Image 1' },
            { id: 2, url: 'http://example.com/img2.jpg', alt: 'Image 2' },
        ];
        const block = makeGalleryBlock(attachments);

        expect(block).toContain('wp:gallery');
        expect(block).toContain('wp:image');
        expect(block).toContain('"id":1');
        expect(block).toContain('"id":2');
        expect(block).toContain('alt="Image 1"');
        expect(block).toContain('alt="Image 2"');
        expect(block).toContain('masonry-gallery');
    });

    it('uses default lightbox group for continuous navigation', () => {
        const attachments = [{ id: 1, url: 'http://example.com/img1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments);
        expect(block).toContain('"group":"gallery-lightbox"');
    });

    it('uses custom group ID', () => {
        const attachments = [{ id: 1, url: 'http://example.com/img1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments, 'custom-group');
        expect(block).toContain('"group":"custom-group"');
    });

    it('handles empty alt text', () => {
        const attachments = [{ id: 1, url: 'http://example.com/img1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments);
        expect(block).toContain('alt=""');
    });
});

// ---------- makeTocBlock ----------
describe('makeTocBlock', () => {
    it('creates dropdown with section options', () => {
        const sections = [
            { name: 'Section One' },
            { name: 'Section Two' },
        ];
        const block = makeTocBlock(sections);

        expect(block).toContain('wp:html');
        expect(block).toContain('<select');
        expect(block).toContain('value="#section-one"');
        expect(block).toContain('value="#section-two"');
        expect(block).toContain('>Section One</option>');
        expect(block).toContain('>Section Two</option>');
    });
});

// ---------- makeSectionContent ----------
describe('makeSectionContent', () => {
    it('creates sections with headings and galleries', () => {
        const sections = [
            { name: 'Section A', attachments: [{ id: 1, url: 'http://example.com/a.jpg', alt: 'A' }] },
            { name: 'Section B', attachments: [{ id: 2, url: 'http://example.com/b.jpg', alt: 'B' }] },
        ];
        const content = makeSectionContent(sections);

        // Check both sections are present with headings
        expect(content).toContain('Section A');
        expect(content).toContain('Section B');
        expect(content).toContain('"id":1');
        expect(content).toContain('"id":2');
    });

    it('uses same lightbox group for all galleries to enable continuous navigation', () => {
        const sections = [
            { name: 'First', attachments: [{ id: 1, url: 'http://example.com/1.jpg', alt: '1' }] },
            { name: 'Second', attachments: [{ id: 2, url: 'http://example.com/2.jpg', alt: '2' }] },
        ];
        const content = makeSectionContent(sections);

        // All galleries should use the same lightbox group
        const matches = content.match(/"group":"gallery-lightbox"/g);
        // Each section has 2 occurrences: one in wp:gallery and one in wp:image
        expect(matches.length).toBe(4);
    });

    it('allows custom lightbox group', () => {
        const sections = [
            { name: 'Test', attachments: [{ id: 1, url: 'http://example.com/1.jpg', alt: '' }] },
        ];
        const content = makeSectionContent(sections, 'my-custom-group');
        expect(content).toContain('"group":"my-custom-group"');
    });
});

// ---------- makePageContent ----------
describe('makePageContent', () => {
    it('creates page with sections, TOC, and styles when makeSections=true', () => {
        const sections = [
            { name: 'Section A', attachments: [{ id: 1, url: 'http://example.com/a.jpg', alt: 'A' }] },
            { name: 'Section B', attachments: [{ id: 2, url: 'http://example.com/b.jpg', alt: 'B' }] },
        ];
        const content = makePageContent(sections, true);

        // Should contain styles
        expect(content).toContain('masonry-gallery');
        expect(content).toContain('<style>');

        // Should contain TOC
        expect(content).toContain('toc-dropdown');
        expect(content).toContain('<select');

        // Should contain section headings
        expect(content).toContain('Section A');
        expect(content).toContain('Section B');

        // Should contain galleries
        expect(content).toContain('"id":1');
        expect(content).toContain('"id":2');
    });

    it('creates single gallery without TOC when makeSections=false', () => {
        const sections = [
            { name: 'Section A', attachments: [{ id: 1, url: 'http://example.com/a.jpg', alt: 'A' }] },
            { name: 'Section B', attachments: [{ id: 2, url: 'http://example.com/b.jpg', alt: 'B' }] },
        ];
        const content = makePageContent(sections, false);

        // Should contain styles
        expect(content).toContain('masonry-gallery');
        expect(content).toContain('<style>');

        // Should NOT contain TOC
        expect(content).not.toContain('toc-dropdown');
        expect(content).not.toContain('<select');

        // Should NOT contain section headings
        expect(content).not.toContain('wp:heading');
        expect(content).not.toContain('Section A');
        expect(content).not.toContain('Section B');

        // Should contain single gallery with all images
        expect(content).toContain('"id":1');
        expect(content).toContain('"id":2');

        // Should only have one gallery block (for continuous lightbox)
        const galleryMatches = content.match(/wp:gallery/g);
        expect(galleryMatches.length).toBe(2); // opening and closing
    });
});

// ---------- makeUniqueFilename ----------
describe('makeUniqueFilename', () => {
    it('creates unique filename by prefixing with folder name', () => {
        const result = makeUniqueFilename('Summer', 'photo.jpg');
        expect(result).toBe('Summer-photo.jpg');
    });

    it('sanitizes folder name with special characters', () => {
        const result = makeUniqueFilename('Summer 2024!', 'photo.jpg');
        expect(result).toBe('Summer-2024-photo.jpg');
    });

    it('handles multiple consecutive special characters', () => {
        const result = makeUniqueFilename('Summer   &&&   2024', 'photo.jpg');
        expect(result).toBe('Summer-2024-photo.jpg');
    });

    it('removes leading and trailing dashes', () => {
        const result = makeUniqueFilename('---Summer---', 'photo.jpg');
        expect(result).toBe('Summer-photo.jpg');
    });

    it('handles folder names with accents and unicode', () => {
        const result = makeUniqueFilename('Été 2024', 'photo.jpg');
        expect(result).toBe('t-2024-photo.jpg');
    });
});

// ---------- makeMasonryStyles ----------
describe('makeMasonryStyles', () => {
    it('creates CSS style block', () => {
        const styles = makeMasonryStyles();
        expect(styles).toContain('wp:html');
        expect(styles).toContain('<style>');
        expect(styles).toContain('.masonry-gallery');
        expect(styles).toContain('flex-wrap');
        expect(styles).toContain('@media');
    });
});

// ---------- isCacheValid ----------
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
});
