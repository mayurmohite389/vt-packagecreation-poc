#!/usr/bin/env node
/**
 * Runs each command from combination-commands.json one by one, and writes
 * the command plus its output (stats) into a single results file.
 * Before running, downloads POC assets from S3 to input location if docs/input files.txt
 * defines "input S3" and "input location".
 * Usage: node scripts/run-combination-commands.js [commands.json] [results.txt]
 */

import { readFileSync, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { downloadPrefix } from '../src/s3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const commandsPath = process.argv[2] || join(root, 'docs', 'combination-commands.json');
const resultsPath = process.argv[3] || join(root, 'docs', 'combination-commands-results.txt');
const inputFilesPath = join(root, 'docs', 'input files.txt');

function parseInputFiles(content) {
  const m = {};
  for (const line of content.split(/\r?\n/)) {
    const i = line.indexOf(' : ');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 3).trim();
    if (value) m[key] = value;
  }
  return m;
}

function parseS3Uri(uri) {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.*)$/);
  if (!match) return null;
  const prefix = match[2] ? (match[2].endsWith('/') ? match[2] : match[2] + '/') : '';
  return { bucket: match[1], prefix };
}

async function ensureAssetsDownloaded() {
  let content;
  try {
    content = readFileSync(inputFilesPath, 'utf8');
  } catch {
    console.log('Download step skipped: docs/input files.txt not found.');
    return;
  }
  const m = parseInputFiles(content);
  const inputLocation = (m['input location'] || '').replace(/\/$/, '');
  const inputS3 = m['input S3 (download all to input location)'] || m['input S3'] || '';
  if (!inputLocation || !inputS3 || !inputS3.startsWith('s3://')) {
    console.log('Download step skipped: set "input location" and "input S3 (download all to input location)" in docs/input files.txt to enable.');
    return;
  }
  const parsed = parseS3Uri(inputS3);
  if (!parsed) {
    console.log('Download step skipped: invalid input S3 URI in docs/input files.txt.');
    return;
  }
  console.log('Download start.');
  const { downloaded } = await downloadPrefix(parsed.bucket, parsed.prefix, inputLocation);
  console.log('Download end.', downloaded, 'file(s).');
}

function formatCommand(args) {
  return 'node src/index.js ' + args.map((a) => (a.includes(' ') || a.includes(',') ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}

function runOne(item, outStream) {
  return new Promise((resolve) => {
    const args = ['src/index.js', ...item.args];
    const cmdStr = formatCommand(item.args);
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      const sep = '='.repeat(80);
      const block = [
        '',
        sep,
        `=== ${item.name} ===`,
        sep,
        'Command:',
        cmdStr,
        '',
        'Output:',
        stdout.trim() || '(no stdout)',
        stderr.trim() ? `\nStderr:\n${stderr.trim()}` : '',
        `\nExit code: ${code}`,
        '',
      ].join('\n');
      outStream.write(block, () => resolve(code));
    });
  });
}

async function main() {
  await ensureAssetsDownloaded();

  const raw = readFileSync(commandsPath, 'utf8');
  const commands = JSON.parse(raw);
  if (!Array.isArray(commands) || commands.length === 0) {
    console.error('No commands found in', commandsPath);
    process.exit(1);
  }

  const out = createWriteStream(resultsPath, { flags: 'w' });
  const header = [
    `Combination commands run at ${new Date().toISOString()}`,
    `Commands file: ${commandsPath}`,
    `Total: ${commands.length} command(s)`,
    '',
  ].join('\n');
  out.write(header);

  console.log('Running', commands.length, 'commands. Results will be written to', resultsPath);
  for (let i = 0; i < commands.length; i++) {
    const item = commands[i];
    console.log(`[${i + 1}/${commands.length}] ${item.name}`);
    const code = await runOne(item, out);
    if (code !== 0) console.error(`  -> exit code ${code}`);
  }
  out.end();
  console.log('Done. Results written to', resultsPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
