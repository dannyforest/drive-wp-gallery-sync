// src/drive.js
// Google Drive API integration

const { google } = require('googleapis');
const { env } = require('./utils');

/**
 * Create authenticated Google Drive client
 * @returns {Promise<Object>} Google Drive API client
 */
async function createDrive() {
    const json = env('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is required');

    let creds;
    try {
        creds = JSON.parse(json);
    } catch (e) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }

    const auth = new google.auth.JWT(
        creds.client_email,
        null,
        creds.private_key,
        ['https://www.googleapis.com/auth/drive.readonly']
    );
    await auth.authorize();
    return google.drive({ version: 'v3', auth });
}

/**
 * Generate direct Google Drive image URL
 * @param {string} fileId - Google Drive file ID
 * @returns {string} Direct image URL
 */
function makeGoogleDriveImageUrl(fileId) {
    // Generate a direct Google Drive image URL
    // This URL format works for publicly accessible files or files shared with the service account
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * List all subfolders in a Google Drive folder
 * @param {Object} drive - Google Drive API client
 * @param {string} folderId - Parent folder ID
 * @returns {Promise<Array>} Array of folder objects with id and name
 */
async function listSubFolders(drive, folderId) {
    const folders = [];
    let pageToken = null;
    do {
        const { data } = await drive.files.list({
            q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            pageToken
        });
        folders.push(...(data.files || []));
        pageToken = data.nextPageToken || null;
    } while (pageToken);
    // Sort folders alphabetically by name
    folders.sort((a, b) => a.name.localeCompare(b.name));
    return folders;
}

/**
 * List all images in a Google Drive folder
 * @param {Object} drive - Google Drive API client
 * @param {string} folderId - Folder ID
 * @returns {Promise<Array>} Array of image file objects
 */
async function listImagesInFolder(drive, folderId) {
    const out = [];
    let pageToken = null;
    do {
        const { data } = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, description)',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            pageToken
        });

        for (const f of data.files || []) {
            if ((f.mimeType || '').startsWith('image/')) {
                out.push(f);
            }
        }
        pageToken = data.nextPageToken || null;
    } while (pageToken);
    return out;
}

/**
 * Download a file from Google Drive
 * @param {Object} drive - Google Drive API client
 * @param {string} fileId - File ID to download
 * @returns {Promise<Buffer>} File contents as Buffer
 */
async function downloadDriveFile(drive, fileId) {
    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(res.data);
}

module.exports = {
    createDrive,
    makeGoogleDriveImageUrl,
    listSubFolders,
    listImagesInFolder,
    downloadDriveFile,
};

