// worker/sources/local.js
// Local filesystem source: reads files from ./ftp-test/incoming without modifying or deleting them.

import fs from "node:fs";
import path from "node:path";

const INCOMING_DIR = path.resolve(process.cwd(), "ftp-test/incoming");

function ensureDirectory() {
  if (!fs.existsSync(INCOMING_DIR)) {
    fs.mkdirSync(INCOMING_DIR, { recursive: true });
  }
}

/**
 * Lists all readable files in the local incoming directory.
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
export async function list() {
  ensureDirectory();
  const entries = fs.readdirSync(INCOMING_DIR, { withFileTypes: true });

  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith(".")) {
      const fullPath = path.join(INCOMING_DIR, entry.name);
      const stat = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        size: stat.size,
      });
    }
  }

  return files;
}

/**
 * Reads a file from the local incoming directory as a Buffer.
 * Never modifies or deletes the file.
 * @param {string} name Base file name
 * @returns {Promise<Buffer>}
 */
export async function read(name) {
  ensureDirectory();
  const fullPath = path.join(INCOMING_DIR, name);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Local source file not found: ${name}`);
  }
  return fs.readFileSync(fullPath);
}
