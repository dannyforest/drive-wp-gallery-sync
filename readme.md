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
  zip -r lambda.zip index.js node_modules package.json
  ```
- Upload to Lambda and configure environment variables.
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
| `RECURSIVE` | No | `false` | Scan subfolders recursively |
| `ORDER` | No | `name_asc` | Image sort order |
| `DRY_RUN` | No | `false` | Test mode (no uploads or page updates) |
| `MAX_SIZE` | No | `1024` | Max image dimension in pixels (0 to disable) |

---

## Parameters

All parameters can be passed via **query string**, **JSON body**, or **environment variables** (in that priority order).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `folderId` | string | - | Google Drive folder ID containing images |
| `pageId` | number | - | WordPress page ID to update with gallery |
| `recursive` | boolean | `false` | Include images from subfolders |
| `order` | string | `name_asc` | Sort order for images |
| `dryRun` | boolean | `false` | Preview mode without making changes |
| `maxSize` | number | `1024` | Max width/height in pixels. Images exceeding this are resized proportionally. Set to `0` to disable resizing. |
| `wpBaseUrl` | string | - | WordPress site URL |
| `wpUser` | string | - | WordPress username |
| `wpPass` | string | - | WordPress application password |

### Sort Order Options

- `name_asc` – Alphabetical A-Z (default)
- `name_desc` – Alphabetical Z-A
- `modified_asc` – Oldest first
- `modified_desc` – Newest first

---

## Usage Examples

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

### 2) Create a `.env` file

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
WP_BASE_URL=https://your-site.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
WP_PAGE_ID=123
MAX_SIZE=1024
RECURSIVE=false
DRY_RUN=true
```

### 3) Run locally

```bash
node local.js
```

This runs the Lambda handler locally using `local.js`, which:
- Loads environment variables from `.env`
- Simulates a Lambda invocation
- Defaults to `dryRun=true` for safety (no actual uploads or page changes)

To perform a real sync, set `DRY_RUN=false` in your `.env` file or modify `local.js`.

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