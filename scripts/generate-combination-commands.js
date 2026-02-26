#!/usr/bin/env node
/**
 * Generates docs/combination-commands.json from the CSV combination files and
 * docs/input files.txt. Each entry has { name, args } for the runner script.
 * Usage: node scripts/generate-combination-commands.js [--gpu] [--gpu-stitch] [--vertical-only|--horizontal-only] [path-to-input-files] [path-to-output-json]
 *   --gpu             Add --gpu to every generated command (use NVENC on g5 etc.).
 *   --gpu-stitch      Add --gpu-stitch so fade/stitch step uses GPU (use with --gpu; can cause SIGSEGV on some setups).
 *   --vertical-only   Only vertical (9:16) combinations from vertical_input_combinations.csv.
 *   --horizontal-only Only horizontal (16:9) combinations from horizontal_input_combinations.csv.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docs = join(root, 'docs');

const argv = process.argv.slice(2);
const useGpu = argv.includes('--gpu');
const useGpuStitch = argv.includes('--gpu-stitch');
const verticalOnly = argv.includes('--vertical-only');
const horizontalOnly = argv.includes('--horizontal-only');
const positional = argv.filter((a) => !['--gpu', '--gpu-stitch', '--vertical-only', '--horizontal-only'].includes(a));
const inputFilesTxt = positional[0] || join(docs, 'input files.txt');
const outputJson = positional[1] || join(docs, 'combination-commands.json');

function parseInputFiles(content) {
  const m = {};
  for (const line of content.split(/\r?\n/)) {
    const i = line.indexOf(' : ');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 3).trim();
    if (value) m[key] = value;
  }
  const base = (m['input location'] || '/opt/live-streams/content/poctest').replace(/\/$/, '');
  const outEfs = (m['output location on EFS'] || '').replace(/\/$/, '') || `${base}/output`;
  const s3Full = m['output location on S3'] || '';
  const s3Prefix = s3Full.includes('/') ? s3Full.replace(/^s3:\/\/[^/]+\//, '') : 'packagetest/';
  return {
    inputPath: `${base}/${m['input file'] || '3508834.mp4'}`,
    gfxManifest: `${base}/${m['graphics manifest file'] || '3508834_gfx.json'}`,
    cropPath: `${base}/${m['crop file'] || '3508834_crop.json'}`,
    startPlate16_9: `${base}/${m['start plate for 16:9 video'] || 'start_plate16_9.mp4'}`,
    endPlate16_9: `${base}/${m['end plate for 16:9 video'] || 'end_plate16_9.mp4'}`,
    startPlate9_16: `${base}/${m['start plate for 9:16 video'] || 'start_plate9_16.mp4'}`,
    endPlate9_16: `${base}/${m['end plate for 9:16 video'] || 'end_plate9_16.mp4'}`,
    outputDir: outEfs,
    s3Prefix: s3Prefix || 'packagetest/',
  };
}

function parseCsv(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((s) => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((s) => s.trim());
    const row = {};
    header.forEach((h, j) => { row[h] = values[j]; });
    rows.push(row);
  }
  return rows;
}

function buildArgs(paths, row, orientation, addGpu, addGpuStitch) {
  const n = parseInt(row.Number_Of_Clips, 10) || 1;
  const graphic = (row.Graphic || '').toUpperCase() === 'TRUE';
  const plate = (row.Start_end_plate || '').toUpperCase() === 'TRUE';
  const inputPathsStr = Array(n).fill(paths.inputPath).join(',');
  const args = ['process-local'];
  if (addGpu) args.push('--gpu');
  if (addGpuStitch) args.push('--gpu-stitch');
  args.push('--input-paths', inputPathsStr);
  if (orientation === 'vertical') {
    // One aspect-json path per clip so every clip is cropped to 9:16 (avoids xfade size mismatch).
    // With plates: orderedPaths = [startPlate, ...n content, endPlate] → aspect = empty, crop×n, empty.
    const aspectPaths = plate
      ? ['', ...Array(n).fill(paths.cropPath), '']
      : Array(n).fill(paths.cropPath);
    args.push('--aspect-json-paths', aspectPaths.join(','), '--aspect-ratio', '9:16');
  }
  if (plate) {
    const start = orientation === 'horizontal' ? paths.startPlate16_9 : paths.startPlate9_16;
    const end = orientation === 'horizontal' ? paths.endPlate16_9 : paths.endPlate9_16;
    args.push('--start-plate', start, '--end-plate', end);
  }
  if (graphic) args.push('--gfx-manifest', paths.gfxManifest);
  return args;
}

function outputName(orientation, n, graphic, plate, addGpuSuffix = false) {
  const o = orientation === 'horizontal' ? 'h' : 'v';
  const g = graphic ? 'gfx' : 'no_gfx';
  const p = plate ? 'plate' : 'no_plate';
  const base = `3508834_${o}_${n}_${g}_${p}`;
  return addGpuSuffix ? `${base}_gpu.mp4` : `${base}.mp4`;
}

function main() {
  const inputFilesContent = readFileSync(inputFilesTxt, 'utf8');
  const paths = parseInputFiles(inputFilesContent);
  const horizontalRows = parseCsv(join(docs, 'horizontal_input_combinations.csv'));
  const verticalRows = parseCsv(join(docs, 'vertical_input_combinations.csv'));

  const commands = [];
  if (!verticalOnly) {
    horizontalRows.forEach((row) => {
      const n = parseInt(row.Number_Of_Clips, 10);
      const graphic = (row.Graphic || '').toUpperCase() === 'TRUE';
      const plate = (row.Start_end_plate || '').toUpperCase() === 'TRUE';
      const outName = outputName('horizontal', n, graphic, plate, useGpu);
      const args = buildArgs(paths, row, 'horizontal', useGpu, useGpuStitch);
      args.push('--output-path', `${paths.outputDir}/${outName}`, '--s3-output-key', `${paths.s3Prefix}${outName}`);
      commands.push({ name: `horizontal_${n}_${graphic ? 'gfx' : 'no_gfx'}_${plate ? 'plate' : 'no_plate'}`, args });
    });
  }
  if (!horizontalOnly) {
    verticalRows.forEach((row) => {
      const n = parseInt(row.Number_Of_Clips, 10);
      const graphic = (row.Graphic || '').toUpperCase() === 'TRUE';
      const plate = (row.Start_end_plate || '').toUpperCase() === 'TRUE';
      const outName = outputName('vertical', n, graphic, plate, useGpu);
      const args = buildArgs(paths, row, 'vertical', useGpu, useGpuStitch);
      args.push('--output-path', `${paths.outputDir}/${outName}`, '--s3-output-key', `${paths.s3Prefix}${outName}`);
      commands.push({ name: `vertical_${n}_${graphic ? 'gfx' : 'no_gfx'}_${plate ? 'plate' : 'no_plate'}`, args });
    });
  }

  writeFileSync(outputJson, JSON.stringify(commands, null, 2), 'utf8');
  const parts = [commands.length, 'commands to', outputJson];
  if (useGpu) parts.push('(with --gpu)');
  if (useGpuStitch) parts.push('(with --gpu-stitch)');
  if (verticalOnly) parts.push('(vertical only)');
  if (horizontalOnly) parts.push('(horizontal only)');
  console.log('Wrote', parts.join(' '));
}

main();
