# Drive → WordPress Gallery Sync (AWS Lambda)

A tiny, stateless **Lambda function** you can call via a **Function URL** to:
1) list images in a **Google Drive folder**,
2) upload them to **WordPress Media**, and
3) (re)build a **Gutenberg `wp:gallery` block** on a target page.

It includes **filename-based dedupe** (no WordPress custom meta): if an attachment with the same filename/title already exists, it reuses its ID instead of re-uploading.

---

## Quick start

### 1) Prepare Google Drive access
- Create a **Service Account** in Google Cloud.
- Grant it read access to your folder:
  - Either move the folder to a Shared Drive the SA can read, **or**
  - **Share the folder** with the service account email (Viewer).
- Download the service account JSON.

### 2) Prepare WordPress access
- Create an **Application Password** (WP ≥ 5.6) for a user with permission to upload media and edit the page.
- Note your **site base URL** and the **page ID** you want to update.

### 3) Deploy to Lambda
- Runtime: **Node.js 20**
- Zip contents:
  ```bash
  npm install
  zip -r lambda.zip index.js config.js node_modules package.json
  ```
- Upload to Lambda and configure environment variables (sensitive credentials only).
- Configure defaults in `config.js` before zipping.
- Enable a **Function URL** or attach to API Gateway.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | - | JSON string of Google service account credentials |
| `GOOGLE_DRIVE_FOLDER_ID` | No | - | Default Google Drive folder ID |
| `WP_BASE_URL` | Yes | - | WordPress site URL (e.g., `https://example.com`) |
| `WP_USERNAME` | Yes | - | WordPress username |
| `WP_APP_PASSWORD` | Yes | - | WordPress application password |
| `WP_PAGE_ID` | No | - | Default WordPress page ID to update |

---

## Configuration

Configuration is managed through two files:

### `config.js` - Non-sensitive defaults
Contains default configuration values that can be committed to version control. These values are used when not overridden by environment variables or request parameters.

### `.env` - Sensitive credentials
Contains sensitive information like API keys, passwords, and specific resource IDs. **Never commit this file to version control.**

### Configuration Priority

Values are resolved in the following order (highest to lowest priority):

1. **Query string parameters** (e.g., `?dryRun=true`)
2. **JSON body parameters** (for POST requests)
3. **Environment variables** (from `.env` or Lambda environment)
4. **config.js** (default values)
5. **Hardcoded defaults** (in code)

This allows you to:
- Set sensible defaults in `config.js`
- Override with environment variables for different environments
- Override per-request with query parameters or JSON body

---

## Configuration Options

All parameters can be passed via **query string**, **JSON body**, **environment variables**, or **config.js** (in that priority order).

### Core Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `folderId` | string | - | Google Drive folder ID containing images |
| `pageId` | number | - | WordPress page ID to update with gallery |
| `wpBaseUrl` | string | - | WordPress site URL |
| `wpUser` | string | - | WordPress username |
| `wpPass` | string | - | WordPress application password |

### Behavior Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `DRY_RUN` | boolean | `false` | Preview mode without making changes. Useful for testing. |
| `RECURSIVE` | boolean | `true` | Include images from subfolders recursively |
| `USE_PHOTOS_FROM_ROOT_FOLDER` | boolean | `true` | Include photos from the root folder (not just subfolders) |
| `USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY` | boolean | `true` | Use Google Drive URLs directly in gallery (faster, no upload). If `false`, uploads images to WordPress Media Library. |
| `CLEAR_CONTENT` | boolean | `true` | Clear existing page content before syncing |
| `ORDER` | string | `name_asc` | Sort order for images (see below) |
| `MAKE_SECTIONS` | boolean | `false` | Organize images into sections by folder name |

### Upload Options (only used when `USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY` is `false`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `MAX_SIZE` | number | `1024` | Max width/height in pixels. Images exceeding this are resized proportionally. Set to `0` to disable resizing. |
| `UPLOAD_LIMIT` | number | `-1` | Maximum number of images to upload. Set to `-1` for unlimited. |
| `REFRESH_CACHE` | boolean | `true` | Refresh the WordPress media cache before syncing |
| `FORCE_REUPLOAD` | boolean | `true` | Force re-upload of images even if they already exist in WordPress |

### Sort Order Options

- `name_asc` – Alphabetical A-Z (default)
- `name_desc` – Alphabetical Z-A
- `modified_asc` – Oldest first
- `modified_desc` – Newest first

---

## Common Use Cases

### Use Case 1: Fast Gallery with Google Drive URLs (Recommended)

**Scenario:** You want to quickly display photos from Google Drive without uploading them to WordPress.

**Benefits:**
- ⚡ Fast sync (no uploads)
- 💾 Saves WordPress storage space
- 🔄 Easy to update (just re-run sync)

**Config:**
```javascript
{
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: true,
  RECURSIVE: true,
  USE_PHOTOS_FROM_ROOT_FOLDER: true,
  CLEAR_CONTENT: true,
  MAKE_SECTIONS: false,
  ORDER: "name_asc"
}
```

**When to use:** Event galleries, photo albums, temporary displays

---

### Use Case 2: Organized Multi-Folder Gallery with Sections

**Scenario:** You have photos organized in subfolders (e.g., "Morning Session", "Afternoon Session", "Awards") and want each folder to appear as a separate section on the page.

**Benefits:**
- 📁 Automatic organization by folder
- 📑 Table of contents for navigation
- 🎨 Professional layout with headings

**Config:**
```javascript
{
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: true,
  RECURSIVE: true,
  USE_PHOTOS_FROM_ROOT_FOLDER: false, // Only use subfolder photos
  MAKE_SECTIONS: true,
  CLEAR_CONTENT: true,
  ORDER: "name_asc"
}
```

**When to use:** Multi-day events, categorized photo collections, professional portfolios

---

### Use Case 3: WordPress Media Library Upload

**Scenario:** You want photos permanently stored in WordPress Media Library for better integration with WordPress features (editing, metadata, etc.).

**Benefits:**
- 🖼️ Photos available in WordPress Media Library
- ✏️ Can edit/crop in WordPress
- 🔍 Better SEO with WordPress image optimization plugins
- 📱 WordPress responsive image features

**Config:**
```javascript
{
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: false,
  RECURSIVE: true,
  USE_PHOTOS_FROM_ROOT_FOLDER: true,
  MAX_SIZE: 1024,
  UPLOAD_LIMIT: -1,
  REFRESH_CACHE: true,
  FORCE_REUPLOAD: false, // Reuse existing uploads
  CLEAR_CONTENT: true,
  ORDER: "name_asc"
}
```

**When to use:** Permanent galleries, when you need WordPress image features, SEO-critical pages

---

### Use Case 4: Testing/Preview Mode

**Scenario:** You want to test the sync without making any actual changes to WordPress.

**Benefits:**
- 🧪 Safe testing
- 👀 Preview what will happen
- 🐛 Debugging

**Config:**
```javascript
{
  DRY_RUN: true,
  // ... other settings
}
```

**When to use:** Testing new configurations, debugging issues, verifying folder contents

---

### Use Case 5: Latest Photos First

**Scenario:** You want the most recently added/modified photos to appear first in the gallery.

**Config:**
```javascript
{
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: true,
  ORDER: "modified_desc",
  RECURSIVE: true,
  CLEAR_CONTENT: true
}
```

**When to use:** News galleries, ongoing event coverage, chronological displays

---

### Use Case 6: Limited Upload for Large Collections

**Scenario:** You have 1000+ photos but only want to upload the first 50 to WordPress.

**Config:**
```javascript
{
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: false,
  UPLOAD_LIMIT: 50,
  ORDER: "name_asc", // or "modified_desc" for newest 50
  MAX_SIZE: 1024,
  RECURSIVE: true
}
```

**When to use:** Large photo collections, bandwidth limitations, testing uploads

---

## API Usage Examples

**Query string:**
```
GET /sync?folderId=ABC123&pageId=42&maxSize=2048
```

**JSON body:**
```json
{
  "folderId": "ABC123",
  "pageId": 42,
  "recursive": true,
  "order": "modified_desc",
  "maxSize": 2048
}
```

### Response

```json
{
  "ok": true,
  "result": {
    "uploadedCount": 5,
    "reusedCount": 3,
    "totalIdsInGallery": 8,
    "pageId": 42,
    "updated": true
  }
}
```

---

## Image Resizing

Images are automatically resized if their width or height exceeds `maxSize` (default: **1024px**). The aspect ratio is always preserved.

| `maxSize` | Behavior |
|-----------|----------|
| `1024` (default) | Images larger than 1024px on either dimension are resized |
| `2048` | Allows larger images up to 2048px |
| `0` | Disables resizing — uploads original images |

---

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Configure your environment

**Create a `.env` file** with sensitive credentials:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
WP_BASE_URL=https://your-site.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
WP_PAGE_ID=123
```

**Edit `config.js`** for non-sensitive defaults:

```javascript
module.exports = {
  DRY_RUN: true, // Safe default for local testing
  RECURSIVE: true,
  USE_PHOTOS_FROM_ROOT_FOLDER: true,
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: true,
  CLEAR_CONTENT: true,
  ORDER: "name_asc",
  MAKE_SECTIONS: false,
  // Upload options (only used if USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY is false)
  MAX_SIZE: 1024,
  UPLOAD_LIMIT: -1,
  REFRESH_CACHE: true,
  FORCE_REUPLOAD: false
};
```

### 3) Run locally

```bash
node local.js
```

This runs the Lambda handler locally using `local.js`, which:
- Loads environment variables from `.env`
- Loads configuration from `config.js`
- Simulates a Lambda invocation
- Defaults to `DRY_RUN=true` for safety (no actual uploads or page changes)

To perform a real sync, set `DRY_RUN: false` in `config.js` or override it in `.env`.

### 4) Run tests

```bash
npm test
```

Or run in watch mode for development:

```bash
npm run test:watch
```

Tests cover utility functions, WordPress block generators, and cache validation logic.

### Overriding parameters

Edit `local.js` to customize the test event:

```javascript
const event = {
    queryStringParameters: {
        folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
        pageId: process.env.WP_PAGE_ID,
        recursive: "true",
        dryRun: "false",
        maxSize: "2048"
    },
    headers: {},
    body: null
};
```

---

## License

MIT