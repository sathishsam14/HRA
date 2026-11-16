// worker/sources/sftp.js
// SFTP source: uses ssh2-sftp-client with FTP_HOST, FTP_PORT, FTP_USER, FTP_PASSWORD, FTP_PATH.
// Never writes or deletes remote files.

import SftpClient from "ssh2-sftp-client";
import path from "node:path";

function getConfig() {
  return {
    host: process.env.FTP_HOST || "localhost",
    port: parseInt(process.env.FTP_PORT || "22", 10),
    username: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
  };
}

function getRemoteDir() {
  return process.env.FTP_PATH || "/";
}

/**
 * Lists files in the remote SFTP directory.
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
export async function list() {
  const client = new SftpClient();
  try {
    await client.connect(getConfig());
    const remoteDir = getRemoteDir();
    const fileList = await client.list(remoteDir);

    const files = [];
    for (const item of fileList) {
      if (item.type === "-" && !item.name.startsWith(".")) {
        files.push({
          name: item.name,
          size: item.size,
        });
      }
    }
    return files;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Reads a remote file via SFTP as a Buffer.
 * Never modifies or deletes the file.
 * @param {string} name Base file name
 * @returns {Promise<Buffer>}
 */
export async function read(name) {
  const client = new SftpClient();
  try {
    await client.connect(getConfig());
    const remoteFilePath = path.posix.join(getRemoteDir(), name);
    const data = await client.get(remoteFilePath);
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  } finally {
    await client.end().catch(() => {});
  }
}
