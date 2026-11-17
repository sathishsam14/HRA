// worker/sources/local.js
// Local filesystem source: reads files from FTP_PATH in .env.
// Strictly read-only: only lists and reads files, never writes, renames or deletes at the source.

import fs from "node:fs";
import path from "node:path";

function getLocalDir() {
  const envPath = process.env.FTP_PATH || "./ftp-test/incoming";
  return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
}

/**
 * Lists all readable files in the local incoming directory.
 * Never creates directories, writes, renames or deletes files.
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
export async function list() {
  const dir = getLocalDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith(".")) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          size: stat.size,
        });
      } catch {}
    }
  }

  return files;
}

/**
 * Reads a file from the local incoming directory as a Buffer.
 * Never modifies, renames or deletes the file.
 * @param {string} name Base file name
 * @returns {Promise<Buffer>}
 */
export async function read(name) {
  const dir = getLocalDir();
  const fullPath = path.join(dir, name);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Local source file not found: ${name} (path: ${fullPath})`);
  }
  return fs.readFileSync(fullPath);
}
