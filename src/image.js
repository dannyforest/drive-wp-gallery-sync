// src/image.js
// Image processing utilities

const sharp = require('sharp');

const DEFAULT_MAX_IMAGE_SIZE = 1024;

/**
 * Resize image if it exceeds maxSize, maintaining aspect ratio
 * Always applies EXIF rotation to fix orientation issues
 * @param {Buffer} buf - Image buffer
 * @param {number} maxSize - Maximum dimension (width or height) in pixels
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function resizeImageIfNeeded(buf, maxSize) {
    const image = sharp(buf);
    const metadata = await image.metadata();
    let { width, height, orientation } = metadata;

    if (!width || !height) return buf;

    // Adjust width/height for EXIF orientation (orientations 5-8 swap dimensions)
    // See: https://github.com/lovell/sharp/issues/3124
    if (orientation && orientation >= 5) {
        [width, height] = [height, width];
    }

    // Always apply EXIF rotation to fix portrait orientation issues
    if (!maxSize || maxSize <= 0 || (width <= maxSize && height <= maxSize)) {
        // No resize needed, but still apply rotation
        const rotated = await image.rotate().toBuffer();
        return rotated;
    }

    // Resize so the largest dimension equals maxSize, maintaining aspect ratio
    // Auto-rotate based on EXIF orientation before resizing to prevent rotation issues
    const resized = await image
        .rotate() // Auto-rotate based on EXIF orientation data
        .resize({
            width: width > height ? maxSize : undefined,
            height: height >= width ? maxSize : undefined,
            fit: 'inside',
            withoutEnlargement: true
        })
        .toBuffer();

    return resized;
}

module.exports = {
    resizeImageIfNeeded,
    DEFAULT_MAX_IMAGE_SIZE,
};

