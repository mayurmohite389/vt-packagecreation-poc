/**
 * S3 download (input videos) and upload (stitched output) using AWS SDK v3.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
