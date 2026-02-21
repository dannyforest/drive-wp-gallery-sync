// config.js
// Non-sensitive configuration for Drive-WP Gallery Sync

module.exports = {
  // Whether to run in dry-run mode (no actual uploads or changes)
  DRY_RUN: false,

  // Whether to recursively scan subfolders in Google Drive
  RECURSIVE: true,

  // Whether to include photos from the root folder (not just subfolders)
  USE_PHOTOS_FROM_ROOT_FOLDER: true,

  // Whether to use Google Drive photos for the gallery (instead of WordPress media)
  USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY: false,

  // Whether to clear existing page content before syncing
  CLEAR_CONTENT: true,

  // Sort order for images: "name_asc", "name_desc", "modified_asc", "modified_desc"
  ORDER: "name_asc",

  // Whether to organize images into sections by folder
  MAKE_SECTIONS: false,

  // BELOW IS FOR IF USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY IS FALSE. It is ignored if USE_GOOGLE_DRIVE_PHOTOS_FOR_GALLERY IS TRUE.

  // Maximum image size in pixels (width or height). Set to 0 to disable resizing
  MAX_SIZE: 1024,

  // Maximum number of images to upload. Set to -1 for unlimited
  UPLOAD_LIMIT: -1,

  // Whether to refresh the WordPress media cache
  REFRESH_CACHE: true,

  // Whether to force re-upload of images even if they already exist
  FORCE_REUPLOAD: true,

  // Whether to run cleanup mode to delete duplicate media files
  CLEANUP_DUPLICATES: false,

  // Delay between deletions in milliseconds (to avoid overwhelming WordPress)
  CLEANUP_DELAY_MS: 100,
};

