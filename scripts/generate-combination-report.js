#!/usr/bin/env node
/**
 * Parses combination-commands-results *.txt and writes report matrices:
 * Number of clips | Graphics (yes/no) | Start-end plate (yes/no) | TAT (ms) | TAT (s).
 * Generates combination-commands-report.md (CPU) and combination-commands-report-GPU.md (GPU).
 * Optional: node scripts/generate-combination-report.js <result-file.txt> [<report.md>]
 *   e.g. ... combination-commands-results_1.txt combination-commands-report-1.md
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputResultDir = join(root, 'docs', 'outputresult');

function parseResultFile(content, orientationFromName = false) {
  const blocks = content.split(/\n={5,}\n=== /);
  const rows = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^([^\s=]+)\s*===\n/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    const jsonMatch = block.match(/"tatMs":\s*(\d+)/);
    if (!jsonMatch) continue;
    const tatMs = parseInt(jsonMatch[1], 10);
    const tatSec = (tatMs / 1000).toFixed(1);
    const numMatch = name.match(/_(\d+)_/);
    const numClips = numMatch ? parseInt(numMatch[1], 10) : null;
    const graphics = name.includes('_gfx_') ? 'yes' : 'no';
    const plate = name.includes('_plate') ? 'yes' : 'no';
    const orientation = orientationFromName
      ? (name.startsWith('vertical_') ? 'Vertical' : 'Horizontal')
      : null;
    rows.push({
      orientation,
      name,
      numClips,
      graphics,
      plate,
      tatMs,
      tatSec,
    });
  }
  return rows;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.orientation !== b.orientation) return a.orientation === 'Vertical' ? -1 : 1;
    if (a.numClips !== b.numClips) return (a.numClips || 0) - (b.numClips || 0);
    if (a.graphics !== b.graphics) return a.graphics === 'yes' ? 1 : -1;
    return a.plate === 'yes' ? 1 : -1;
  });
}

function buildReportMd(title, sourceFiles, allRows) {
  const header = '| Orientation | Number of clips | Graphics | Start-end plate | TAT (ms) | TAT (s) |';
  const sep = '|-------------|-----------------|----------|-----------------|----------|--------|';
  const tableRows = allRows.map(
    (r) =>
      `| ${r.orientation} | ${r.numClips ?? '-'} | ${r.graphics} | ${r.plate} | ${r.tatMs.toLocaleString()} | ${r.tatSec} |`
  );
  const verticalRows = allRows.filter((r) => r.orientation === 'Vertical');
  const horizontalRows = allRows.filter((r) => r.orientation === 'Horizontal');

  const subHeader = '| Number of clips | Graphics | Start-end plate | TAT (ms) | TAT (s) |';
  const subSep = '|----------------|----------|-----------------|----------|--------|';

  const lines = [
    `# ${title}`,
    '',
    `Generated from ${sourceFiles}.`,
    '',
    header,
    sep,
    ...tableRows,
    '',
    '## Matrix by orientation',
    '',
    '### Vertical (9:16)',
    '',
    subHeader,
    subSep,
    ...verticalRows.map(
      (r) => `| ${r.numClips ?? '-'} | ${r.graphics} | ${r.plate} | ${r.tatMs.toLocaleString()} | ${r.tatSec} |`
    ),
    '',
    '### Horizontal (16:9)',
    '',
    subHeader,
    subSep,
    ...horizontalRows.map(
      (r) => `| ${r.numClips ?? '-'} | ${r.graphics} | ${r.plate} | ${r.tatMs.toLocaleString()} | ${r.tatSec} |`
    ),
    '',
  ];
  return lines.join('\n');
}

function main() {
  const customInput = process.argv[2];
  const customOutput = process.argv[3];

  if (customInput) {
    const resultPath = join(customInput.startsWith('/') || /^[A-Za-z]:/.test(customInput) ? '' : root, customInput);
    const reportPath = customOutput
      ? join((customOutput.startsWith('/') || /^[A-Za-z]:/.test(customOutput) ? '' : root), customOutput)
      : resultPath.replace(/\.txt$/i, '-report.md');
    let content = '';
    try {
      content = readFileSync(resultPath, 'utf8');
    } catch (e) {
      console.error('Could not read:', resultPath, e.message);
      process.exit(1);
    }
    const rows = parseResultFile(content, true);
    if (rows.length === 0) {
      console.warn('No entries parsed from', resultPath);
      process.exit(1);
    }
    const title = `Combination commands – TAT report (${basename(resultPath, '.txt')})`;
    const report = buildReportMd(title, `\`${basename(resultPath)}\``, sortRows(rows));
    writeFileSync(reportPath, report + '\n---\n\n*Source: `' + basename(resultPath) + '`*\n', 'utf8');
    console.log('Report written to', reportPath);
    return;
  }

  const verticalPath = join(outputResultDir, 'combination-commands-results vertical.txt');
  const horizontalPath = join(outputResultDir, 'combination-commands-results horizontal.txt');
  const gpuPath = join(outputResultDir, 'combination-commands-results GPU.txt');

  let verticalContent = '';
  let horizontalContent = '';
  let gpuContent = '';
  try {
    verticalContent = readFileSync(verticalPath, 'utf8');
  } catch (e) {
    console.warn('Could not read vertical results:', e.message);
  }
  try {
    horizontalContent = readFileSync(horizontalPath, 'utf8');
  } catch (e) {
    console.warn('Could not read horizontal results:', e.message);
  }
  try {
    gpuContent = readFileSync(gpuPath, 'utf8');
  } catch (e) {
    console.warn('Could not read GPU results:', e.message);
  }

  // CPU report: vertical + horizontal (orientation from filename)
  const verticalRows = parseResultFile(verticalContent, false).map((r) => ({ ...r, orientation: 'Vertical' }));
  const horizontalRows = parseResultFile(horizontalContent, false).map((r) => ({ ...r, orientation: 'Horizontal' }));
  const cpuRows = sortRows([...verticalRows, ...horizontalRows]);

  const cpuReport = buildReportMd(
    'Combination commands – TAT report (CPU)',
    '`combination-commands-results vertical.txt` and `combination-commands-results horizontal.txt`',
    cpuRows
  );
  const cpuReportPath = join(outputResultDir, 'combination-commands-report.md');
  writeFileSync(cpuReportPath, cpuReport + '\n---\n\n*To regenerate: `node scripts/generate-combination-report.js`*\n', 'utf8');
  console.log('Report written to', cpuReportPath);

  // GPU report: single file, orientation from name (vertical_ / horizontal_)
  const gpuRowsRaw = parseResultFile(gpuContent, true);
  if (gpuRowsRaw.length > 0) {
    const gpuRows = sortRows(gpuRowsRaw);
    const gpuReport = buildReportMd(
      'Combination commands – TAT report (GPU)',
      '`combination-commands-results GPU.txt`',
      gpuRows
    );
    const gpuReportPath = join(outputResultDir, 'combination-commands-report-GPU.md');
    writeFileSync(gpuReportPath, gpuReport + '\n---\n\n*To regenerate: `node scripts/generate-combination-report.js`*\n', 'utf8');
    console.log('Report written to', gpuReportPath);
  }
}

main();
