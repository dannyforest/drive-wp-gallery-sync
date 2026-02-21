// src/utils.js
// Utility functions for configuration, string manipulation, and sorting

// ---------- config ----------
let CONFIG = {};
try {
    CONFIG = require('../config.js');
} catch (err) {
    console.log(`[config] Failed to load config.js: ${err.message}`);
}

/**
 * Get environment variable or config value with fallback
 * @param {string} name - Environment variable name
 * @param {*} fallback - Fallback value if not found
 * @returns {*} Value from process.env, CONFIG, or fallback
 */
function env(name, fallback) {
    // Check process.env first, then CONFIG, then fallback
    const envVal = process.env[name];
    if (envVal !== undefined && envVal !== null && envVal !== '') {
        return envVal;
    }
    const configVal = CONFIG[name];
    if (configVal !== undefined && configVal !== null) {
        return configVal;
    }
    return fallback;
}

/**
 * Parse boolean value from string
 * @param {*} v - Value to parse
 * @param {boolean} def - Default value
 * @returns {boolean} Parsed boolean value
 */
function parseBool(v, def = false) {
    if (v === undefined || v === null) return def;
    return String(v).toLowerCase() === 'true';
}

/**
 * Get sorting comparator function based on order string
 * @param {string} order - Sort order (name_asc, name_desc, modified_desc, modified_asc)
 * @returns {Function} Comparator function
 */
function pickOrder(order) {
    return ({
        name_asc: (a, b) => a.name.localeCompare(b.name),
        name_desc: (a, b) => b.name.localeCompare(a.name),
        modified_desc: (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime),
        modified_asc: (a, b) => new Date(a.modifiedTime) - new Date(b.modifiedTime),
    }[order] || ((a, b) => a.name.localeCompare(b.name)));
}

/**
 * Create Basic Auth header
 * @param {string} user - Username
 * @param {string} pass - Password
 * @returns {string} Basic Auth header value
 */
function basicAuthHeader(user, pass) {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * Strip file extension from filename
 * @param {string} name - Filename
 * @returns {string} Filename without extension
 */
function stripExt(name) {
    return name.replace(/\.[^.]+$/, '');
}

/**
 * Create unique filename by prefixing with folder name
 * @param {string} folderName - Folder name
 * @param {string} filename - Original filename
 * @returns {string} Unique filename with folder prefix
 */
function makeUniqueFilename(folderName, filename) {
    // Create a unique filename by prefixing with folder name
    // e.g., "Summer/photo.jpg" -> "Summer-photo.jpg"
    const sanitizedFolder = folderName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `${sanitizedFolder}-${filename}`;
}

/**
 * Convert text to valid HTML anchor ID
 * @param {string} text - Text to convert
 * @returns {string} Valid anchor ID
 */
function makeAnchorId(text) {
    // Convert text to a valid HTML anchor ID
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

module.exports = {
    env,
    parseBool,
    pickOrder,
    basicAuthHeader,
    stripExt,
    makeUniqueFilename,
    makeAnchorId,
};

