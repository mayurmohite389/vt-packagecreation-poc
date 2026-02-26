#!/usr/bin/env node
/**
 * Creates a "publish" folder with only the files needed to deploy.
 * Like .NET publish: no node_modules or .git; run npm install on the server.
 * Usage: npm run publish (or node scripts/prepare-publish.js)
 */

import { cpSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'publish');

const SKIP = new Set(['node_modules', '.git', 'publish', 'dist', '.cursor']);

function copyRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    if (statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

// Clean and create publish folder
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Single files at root
cpSync(join(root, 'package.json'), join(out, 'package.json'));
try {
  cpSync(join(root, 'package-lock.json'), join(out, 'package-lock.json'));
} catch {
  // optional
}

// Directories to include
for (const dir of ['src', 'scripts', 'examples', 'docs']) {
  const srcDir = join(root, dir);
  try {
    if (statSync(srcDir).isDirectory()) copyRecursive(srcDir, join(out, dir));
  } catch {
    // dir doesn't exist, skip
  }
}

// Optional: README
try {
  cpSync(join(root, 'README.md'), join(out, 'README.md'));
} catch {
  // ignore
}

console.log('Publish folder created at: ' + out);
console.log('Copy the "publish" folder to the server via FileZilla, then run: npm install');
