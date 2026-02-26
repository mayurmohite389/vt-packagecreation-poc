#!/usr/bin/env node
/**
 * Runs each command from combination-commands.json one by one, and writes
 * the command plus its output (stats) into a single results file.
 * Usage: node scripts/run-combination-commands.js [commands.json] [results.txt]
 */

import { readFileSync, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const commandsPath = process.argv[2] || join(root, 'docs', 'combination-commands.json');
const resultsPath = process.argv[3] || join(root, 'docs', 'combination-commands-results.txt');

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
