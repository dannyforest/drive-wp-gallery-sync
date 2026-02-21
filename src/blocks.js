// src/blocks.js
// WordPress Gutenberg block generators

const { makeAnchorId } = require('./utils');

/**
 * Generate CSS styles for masonry gallery layout
 * @returns {string} WordPress HTML block with CSS styles
 */
function makeMasonryStyles() {
    // CSS for flexbox grid layout - fixed height rows, centered crop
    return `<!-- wp:html -->
<style>
.masonry-gallery.wp-block-gallery {
    display: flex !important;
    flex-wrap: wrap;
    gap: 10px;
}
.masonry-gallery.wp-block-gallery .wp-block-image {
    flex: 0 0 calc(33.333% - 7px);
    height: 300px;
    margin: 0 !important;
    overflow: hidden;
}
.masonry-gallery.wp-block-gallery .wp-block-image img {
    width: 100%;
    height: 100% !important;
    object-fit: cover;
    object-position: center center;
    border-radius: 4px;
}
.masonry-gallery.wp-block-gallery .wp-block-image figure {
    margin: 0;
    height: 100% !important;
}
@media (max-width: 900px) {
    .masonry-gallery.wp-block-gallery .wp-block-image {
        flex: 0 0 calc(50% - 5px);
        height: 250px;
    }
}
@media (max-width: 500px) {
    .masonry-gallery.wp-block-gallery .wp-block-image {
        flex: 0 0 100%;
        height: 300px;
    }
}
</style>
<!-- /wp:html -->`;
}

/**
 * Generate WordPress gallery block with images
 * @param {Array} attachments - Array of {id, url, alt} objects
 * @param {string} groupId - Lightbox group ID for continuous navigation
 * @returns {string} WordPress gallery block
 */
function makeGalleryBlock(attachments, groupId = 'gallery-lightbox') {
    // attachments = [{ id, url, alt }, ...]
    // Use WordPress blocks for lightbox, but add masonry-gallery class for CSS styling
    // IMPORTANT: groupId must be consistent across all galleries for continuous lightbox navigation
    const imageBlocks = attachments.map(({ id, url, alt }) =>
        `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"media","lightbox":{"enabled":true,"group":"${groupId}"}} -->\n<figure class="wp-block-image size-large"><a href="${url}"><img src="${url}" alt="${alt || ''}" class="wp-image-${id}"/></a></figure>\n<!-- /wp:image -->`
    ).join('\n');

    // Add masonry-gallery class and remove is-cropped
    return `<!-- wp:gallery {"linkTo":"media","lightbox":{"enabled":true,"group":"${groupId}"},"className":"masonry-gallery"} -->\n<figure class="wp-block-gallery has-nested-images columns-default masonry-gallery">\n${imageBlocks}\n</figure>\n<!-- /wp:gallery -->`;
}

/**
 * Generate WordPress heading block
 * @param {string} text - Heading text
 * @param {number} level - Heading level (1-6)
 * @param {string|null} anchor - Optional anchor ID
 * @returns {string} WordPress heading block
 */
function makeHeadingBlock(text, level = 2, anchor = null) {
    const anchorAttr = anchor ? `,"anchor":"${anchor}"` : '';
    const idAttr = anchor ? ` id="${anchor}"` : '';
    return `<!-- wp:heading {"level":${level}${anchorAttr}} -->\n<h${level}${idAttr} class="wp-block-heading">${text}</h${level}>\n<!-- /wp:heading -->`;
}

/**
 * Generate WordPress spacer block
 * @param {number} height - Height in pixels
 * @returns {string} WordPress spacer block
 */
function makeSpacerBlock(height = 50) {
    return `<!-- wp:spacer {"height":"${height}px"} -->\n<div style="height:${height}px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`;
}

/**
 * Generate table of contents dropdown block
 * @param {Array} sections - Array of {name} objects
 * @returns {string} WordPress HTML block with TOC dropdown
 */
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

/**
 * Generate section content with headings and galleries
 * @param {Array} sections - Array of {name, attachments} objects
 * @param {string} lightboxGroup - Lightbox group ID
 * @returns {string} WordPress blocks for all sections
 */
function makeSectionContent(sections, lightboxGroup = 'gallery-lightbox') {
    // sections = [{ name, attachments: [{ id, url, alt }, ...] }, ...]
    // Use the same lightboxGroup for all galleries so lightbox continues across sections
    const spacer = makeSpacerBlock(30);
    return sections.map(({ name, attachments }) => {
        const anchor = makeAnchorId(name);
        const heading = makeHeadingBlock(name, 2, anchor);
        const gallery = makeGalleryBlock(attachments, lightboxGroup);
        return `${heading}\n\n${gallery}`;
    }).join(`\n\n${spacer}\n\n`);
}

/**
 * Generate complete page content with styles, TOC, and galleries
 * @param {Array} sections - Array of {name, attachments} objects
 * @param {boolean} makeSections - Whether to create separate sections or single gallery
 * @returns {string} Complete WordPress page content
 */
function makePageContent(sections, makeSections = true) {
    const styles = makeMasonryStyles();

    if (!makeSections) {
        // Single gallery mode: combine all attachments from all sections into one gallery
        // Flexbox flows horizontally (left-to-right), so folders stay grouped naturally
        const allAttachments = sections.flatMap(s => s.attachments);
        const gallery = makeGalleryBlock(allAttachments, 'gallery-lightbox');
        return `${styles}\n\n${gallery}`;
    }

    // Multi-section mode: create TOC and separate galleries per section
    const toc = makeTocBlock(sections);
    const spacerAfterToc = makeSpacerBlock(50);
    const sectionContent = makeSectionContent(sections);
    return `${styles}\n\n${toc}\n\n${spacerAfterToc}\n\n${sectionContent}`;
}

module.exports = {
    makeMasonryStyles,
    makeGalleryBlock,
    makeHeadingBlock,
    makeSpacerBlock,
    makeTocBlock,
    makeSectionContent,
    makePageContent,
};

