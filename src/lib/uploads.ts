import path from "node:path";

/**
 * Where uploaded files live on disk. In production this is a Docker volume
 * mounted at /var/lib/sales-dashboard/uploads (see docker-compose.server.yml).
 * In local dev it falls back to ./uploads in the repo root.
 */
export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
}

/**
 * Make an uploaded filename safe to put on disk and to round-trip through
 * a URL path segment. Strips path separators, control chars, and anything
 * outside [A-Za-z0-9._-]. Caps length so the on-disk name stays sane.
 */
export function sanitizeFilename(name: string): string {
  const stripped = name
    .replace(/[\\/\x00-\x1f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 200);
  return stripped || "file";
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".zip": "application/zip",
};

export function guessMimeType(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || "application/octet-stream";
}
