/**
 * S3 download (input videos) and upload (stitched output) using AWS SDK v3.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-south-1';
const s3 = new S3Client({ region });

/**
 * Download a single object from S3 to a local file.
 * @param {string} bucket
 * @param {string} key
 * @param {string} localPath
 */
export async function downloadObject(bucket, key, localPath) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await s3.send(cmd);
  await mkdir(join(localPath, '..'), { recursive: true });
  const dest = createWriteStream(localPath);
  await pipeline(res.Body, dest);
}

/**
 * Download multiple S3 objects to a local directory. Keys keep their base names.
 * @param {string} bucket
 * @param {string[]} keys - S3 object keys (order preserved)
 * @param {string} localDir - Directory to write files into
 * @returns {Promise<string[]>} Local file paths in same order as keys
 */
export async function downloadObjects(bucket, keys, localDir) {
  await mkdir(localDir, { recursive: true });
  const paths = [];
  for (const key of keys) {
    const baseName = key.split('/').pop() || key.replace(/\//g, '_');
    const localPath = join(localDir, baseName);
    await downloadObject(bucket, key, localPath);
    paths.push(localPath);
  }
  return paths;
}

/**
 * List all object keys under an S3 prefix (handles pagination).
 * @param {string} bucket
 * @param {string} prefix - e.g. "Playground/PackagePOCasset/"
 * @returns {Promise<string[]>} Keys (not including prefix in the key; full key is returned)
 */
export async function listPrefix(bucket, prefix) {
  const keys = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const res = await s3.send(cmd);
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Download all objects under an S3 prefix to a local directory, preserving relative paths.
 * e.g. prefix "Playground/PackagePOCasset/", key "Playground/PackagePOCasset/gfx/1.png" -> localDir/gfx/1.png
 * @param {string} bucket
 * @param {string} prefix - S3 prefix (e.g. "Playground/PackagePOCasset/")
 * @param {string} localDir - Base directory to write files into
 * @returns {Promise<{ downloaded: number, paths: string[] }>}
 */
export async function downloadPrefix(bucket, prefix, localDir) {
  const keys = await listPrefix(bucket, prefix);
  const prefixNorm = prefix.endsWith('/') ? prefix : prefix + '/';
  const paths = [];
  for (const key of keys) {
    const suffix = key.startsWith(prefixNorm) ? key.slice(prefixNorm.length) : key.replace(prefixNorm, '');
    if (!suffix) continue;
    const localPath = join(localDir, suffix);
    await downloadObject(bucket, key, localPath);
    paths.push(localPath);
  }
  return { downloaded: paths.length, paths };
}

/**
 * Upload a local file to S3.
 * @param {string} bucket
 * @param {string} key - S3 object key for the output
 * @param {string} localPath
 */
export async function uploadFile(bucket, key, localPath) {
  const body = createReadStream(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
  }));
}
