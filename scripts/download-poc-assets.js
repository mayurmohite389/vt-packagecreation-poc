#!/usr/bin/env node
/**
 * Download all POC assets from S3 to local storage (e.g. /opt/live-streams/content/poctest).
 * Downloads the entire prefix including the gfx/ folder (PNG images).
 *
 * S3 source: s3://si-davs-playgroundvideos/Playground/PackagePOCasset/
 * Local dest: /opt/live-streams/content/poctest/ (or --dest)
 *
 * Usage:
 *   node scripts/download-poc-assets.js [--dest /path] [--bucket name] [--prefix key]
 *   npm run download-poc-assets [-- --dest /path]
 *
 * Env:
 *   POC_ASSETS_S3_BUCKET   default bucket (si-davs-playgroundvideos)
 *   POC_ASSETS_S3_PREFIX   default prefix (Playground/PackagePOCasset/)
 *   POC_ASSETS_DEST        default local path (/opt/live-streams/content/poctest/)
 */

import { downloadPrefix } from '../src/s3.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
function getOpt(name, envKey, defaultValue) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env[envKey] || defaultValue;
}

const bucket = getOpt('bucket', 'POC_ASSETS_S3_BUCKET', 'si-davs-playgroundvideos');
const prefix = getOpt('prefix', 'POC_ASSETS_S3_PREFIX', 'Playground/PackagePOCasset/');
const dest = getOpt('dest', 'POC_ASSETS_DEST', '/opt/live-streams/content/poctest/');

const prefixNorm = prefix.endsWith('/') ? prefix : prefix + '/';

async function main() {
  console.log('Downloading S3 assets to local storage');
  console.log('  Bucket:', bucket);
  console.log('  Prefix:', prefixNorm);
  console.log('  Dest:  ', dest);
  const { downloaded, paths } = await downloadPrefix(bucket, prefixNorm, dest);
  console.log('Downloaded', downloaded, 'file(s)');
  if (paths.length <= 30) {
    paths.forEach((p) => console.log('  ', p));
  } else {
    paths.slice(0, 15).forEach((p) => console.log('  ', p));
    console.log('  ... and', paths.length - 15, 'more');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
