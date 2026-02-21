// src/blocks.test.js
const {
    makeGalleryBlock,
    makeHeadingBlock,
    makeSpacerBlock,
    makeTocBlock,
    makeMasonryStyles,
    makeSectionContent,
    makePageContent,
} = require('./blocks');

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

    it('uses default lightbox group', () => {
        const attachments = [{ id: 1, url: 'http://example.com/1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments);
        expect(block).toContain('"group":"gallery-lightbox"');
    });

    it('allows custom lightbox group', () => {
        const attachments = [{ id: 1, url: 'http://example.com/1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments, 'custom-group');
        expect(block).toContain('"group":"custom-group"');
    });

    it('handles empty alt text', () => {
        const attachments = [{ id: 1, url: 'http://example.com/1.jpg', alt: '' }];
        const block = makeGalleryBlock(attachments);
        expect(block).toContain('alt=""');
    });
});

// ---------- makeTocBlock ----------
describe('makeTocBlock', () => {
    it('creates TOC dropdown with sections', () => {
        const sections = [
            { name: 'Section A' },
            { name: 'Section B' },
        ];
        const block = makeTocBlock(sections);

        expect(block).toContain('wp:html');
        expect(block).toContain('toc-dropdown');
        expect(block).toContain('<select');
        expect(block).toContain('Section A');
        expect(block).toContain('Section B');
        expect(block).toContain('#section-a');
        expect(block).toContain('#section-b');
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

    it('includes spacers between sections', () => {
        const sections = [
            { name: 'Section A', attachments: [{ id: 1, url: 'http://example.com/a.jpg', alt: 'A' }] },
            { name: 'Section B', attachments: [{ id: 2, url: 'http://example.com/b.jpg', alt: 'B' }] },
        ];
        const content = makeSectionContent(sections);
        expect(content).toContain('wp:spacer');
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

