// worker/sources/ftps.js
// FTPS source: uses basic-ftp with FTP_HOST, FTP_PORT, FTP_USER, FTP_PASSWORD, FTP_PATH.
// Never writes or deletes remote files.

import * as ftp from "basic-ftp";
import { Writable } from "node:stream";
import path from "node:path";

function getConfig() {
  return {
    host: process.env.FTP_HOST || "localhost",
    port: parseInt(process.env.FTP_PORT || "21", 10),
    user: process.env.FTP_USER || "anonymous",
    password: process.env.FTP_PASSWORD || "",
    secure: true,
    secureOptions: {
      rejectUnauthorized: false,
    },
  };
}

function getRemoteDir() {
  return process.env.FTP_PATH || "/";
}

/**
 * Lists files in the remote FTPS directory.
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
export async function list() {
  const client = new ftp.Client();
  try {
    await client.access(getConfig());
    const remoteDir = getRemoteDir();
    await client.cd(remoteDir);
    const fileList = await client.list();

    const files = [];
    for (const item of fileList) {
      if (item.isFile && !item.name.startsWith(".")) {
        files.push({
          name: item.name,
          size: item.size,
        });
      }
    }
    return files;
  } finally {
    client.close();
  }
}

/**
 * Reads a remote file via FTPS as a Buffer.
 * Never modifies or deletes the file.
 * @param {string} name Base file name
 * @returns {Promise<Buffer>}
 */
export async function read(name) {
  const client = new ftp.Client();
  try {
    await client.access(getConfig());
    const remoteFilePath = path.posix.join(getRemoteDir(), name);

    const chunks = [];
    const memoryStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    await client.downloadTo(memoryStream, remoteFilePath);
    return Buffer.concat(chunks);
  } finally {
    client.close();
  }
}
