/**
 * Builds ffmpeg arguments for no-fade (concat) and fade (filter_complex) modes.
 * Supports GPU (h264_nvenc) vs CPU (libx264).
 */

import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import {
  GPU_ENCODER,
  DEFAULT_VIDEO_BITRATE,
  DEFAULT_FADE_DURATION,
  PACKAGE_SCALE_FPS,
  XFADE_SAFETY_BUFFER_SECONDS,
} from './config.js';

/**
 * Get duration of a media file in seconds using ffprobe.
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('close', (code) => {
      const n = parseFloat(out.trim(), 10);
      if (code === 0 && Number.isFinite(n)) resolve(n);
      else reject(new Error(`ffprobe failed: ${out || code}`));
    });
  });
}

/**
 * Get details for one clip (video + audio) via ffprobe, for debugging stitch input mismatches.
 * @param {string} filePath
 * @returns {Promise<{ path: string, video: object, audio: object, duration: number }>}
 */
export function getInputClipDetails(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_streams', '-show_format',
      '-of', 'json', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${out || code}`));
        return;
      }
      try {
        const data = JSON.parse(out);
        const streams = data.streams || [];
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        const format = data.format || {};
        const video = v ? {
          width: parseInt(v.width, 10) || null,
          height: parseInt(v.height, 10) || null,
          r_frame_rate: v.r_frame_rate || null,
          time_base: v.time_base || null,
          pix_fmt: v.pix_fmt || null,
          codec_name: v.codec_name || null,
        } : null;
        const audio = a ? {
          sample_rate: a.sample_rate || null,
          channels: a.channels || null,
          codec_name: a.codec_name || null,
          time_base: a.time_base || null,
        } : null;
        const duration = parseFloat(format.duration, 10) || null;
        resolve({ path: filePath, video, audio, duration });
      } catch (e) {
        reject(new Error(`ffprobe parse failed: ${e.message}`));
      }
    });
  });
}

/**
 * Get video stream dimensions and frame count (for aspect crop).
 * @param {string} filePath
 * @returns {Promise<{ width: number, height: number, nb_frames: number }>}
 */
export function getVideoStreamDetails(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_frames,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${out || code}`));
        return;
      }
      try {
        const data = JSON.parse(out);
        const stream = data.streams?.[0] || data.streams;
        const format = data.format || {};
        const width = parseInt(stream?.width, 10) || 0;
        const height = parseInt(stream?.height, 10) || 0;
        let nbFrames = parseInt(stream?.nb_frames, 10);
        if (!Number.isFinite(nbFrames) && stream?.nb_frames) {
          const parts = String(stream.nb_frames).split('/');
          nbFrames = parseInt(parts[0], 10) || 0;
        }
        if (!Number.isFinite(nbFrames) || nbFrames <= 0) {
          const dur = parseFloat(format.duration, 10) || 0;
          const r = (stream?.r_frame_rate || '25/1').split('/');
          const fps = r.length === 2 ? Number(r[0]) / Number(r[1]) : 25;
          nbFrames = Math.round(dur * fps);
        }
        if (!width || !height) reject(new Error('Could not get video dimensions'));
        else resolve({ width, height, nb_frames: Math.max(1, nbFrames) });
      } catch (e) {
        reject(new Error(`ffprobe parse failed: ${e.message}`));
      }
    });
  });
}

/**
 * Build concat list file content (one "file 'path'" per line).
 * @param {string[]} localPaths - Absolute or relative paths for ffmpeg concat.
 * @returns {Promise<{ listPath: string, listContent: string }>}
 */
export async function buildConcatList(localPaths) {
  const dir = join(tmpdir(), `poc-concat-${randomBytes(6).toString('hex')}`);
  const listPath = join(dir, 'list.txt');
  await mkdir(dir, { recursive: true });
  const lines = localPaths.map((p) => {
    const escaped = p.replace(/\\/g, '/').replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  });
  const listContent = lines.join('\n');
  await writeFile(listPath, listContent, 'utf8');
  return { listPath, listContent };
}

/**
 * Build no-fade (concat) command args. Replaces [input], [output], [videobitrate], and GPU encoder.
 */
export function buildNoFadeArgs(listPath, outputPath, options = {}) {
  const {
    useGpu = false,
    videoBitrate = DEFAULT_VIDEO_BITRATE,
  } = options;
  const inPath = listPath.replace(/\\/g, '/');
  const outPath = outputPath.replace(/\\/g, '/');
  const videoEncode = ['-c:v', useGpu ? GPU_ENCODER.libx264 : 'libx264', '-pix_fmt', 'yuv420p'];
  if (!useGpu) videoEncode.push('-profile:v', 'high', '-level', '4.1', '-preset', 'faster', '-tune', 'film');
  return [
    '-y', '-f', 'concat', '-safe', '0', '-i', inPath,
    '-b:v', videoBitrate, '-map', '0:v:0', '-map', '0:a:0',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    ...videoEncode, '-map_metadata', '0', '-movflags', '+faststart', outPath,
  ];
}

/**
 * Build fade (filter_complex with xfade) command.
 * inputPaths: array of local file paths (order preserved).
 * durations: array of duration in seconds for each input (for xfade offset calculation).
 * options.packageResolution: optional e.g. "608:1080" or "1280:720" to scale all inputs before xfade.
 */
export function buildFadeArgs(inputPaths, durations, outputPath, options = {}) {
  const {
    useGpu = false,
    threads = 0,
    fadeDuration = DEFAULT_FADE_DURATION,
    packageResolution = '',
    packageFps = null,
    fadeSafetyBuffer = XFADE_SAFETY_BUFFER_SECONDS,
  } = options;
  const fps = packageFps ?? PACKAGE_SCALE_FPS;

  const n = inputPaths.length;
  if (n === 0) throw new Error('At least one input required for fade');
  if (n === 1) {
    const outPath = outputPath.replace(/\\/g, '/');
    const args = ['-y', '-i', inputPaths[0]];
    const videoEncode = ['-c:v', useGpu ? GPU_ENCODER.libx264 : 'libx264', '-pix_fmt', 'yuv420p'];
    if (!useGpu) videoEncode.push('-profile:v', 'high', '-level', '4.1', '-preset', 'faster');
    if (packageResolution) {
      const vf = packageFps != null ? `scale=${packageResolution},fps=${fps},setpts=PTS-STARTPTS,settb=AVTB,format=yuv420p` : `scale=${packageResolution},setpts=PTS-STARTPTS,format=yuv420p`;
      args.push('-filter_complex', `[0:v]${vf}[v0];[0:a]aresample=48000,asetpts=PTS-STARTPTS[a0]`, '-map', '[v0]', '-map', '[a0]');
    } else {
      args.push(...videoEncode);
    }
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', outPath);
    return args;
  }

  // When packageResolution is set: scale, optional fps+setpts+settb (PTS reset avoids OOM from ghost timestamps in crop files), and audio 48kHz+asetpts.
  const scalePart = packageFps != null
    ? `scale=${packageResolution},fps=${fps},setpts=PTS-STARTPTS,settb=AVTB`
    : packageResolution
      ? `scale=${packageResolution},setpts=PTS-STARTPTS`
      : null;
  const scaleFilter = scalePart
    ? inputPaths.map((_, i) => `[${i}:v]${scalePart}[v${i}]`).join(';') + ';'
    : '';
  const audioFilter = packageResolution
    ? inputPaths.map((_, i) => `[${i}:a]aresample=48000,asetpts=PTS-STARTPTS[a${i}]`).join(';') + ';'
    : '';
  const normFilter = scaleFilter + audioFilter;
  const vStreamRef = (i) => (packageResolution ? `v${i}` : `${i}:v`);
  const aStreamRef = (i) => (packageResolution ? `a${i}` : `${i}:a`);

  let cumulativeDuration = durations[0];
  const filterParts = [];
  let prevV = vStreamRef(0);
  let prevA = aStreamRef(0);
  for (let i = 1; i < n; i++) {
    // Pull offset back by fadeSafetyBuffer so xfade finishes before the last frame (avoids SIGSEGV).
    const offsetRaw = cumulativeDuration - fadeDuration - fadeSafetyBuffer;
    const offset = Math.round(Math.max(0, offsetRaw) * 100) / 100;
    const nextV = vStreamRef(i);
    const nextA = aStreamRef(i);
    const vLabel = i === n - 1 ? 'vout' : `vfade${i}`;
    const aLabel = i === n - 1 ? 'aout' : `afade${i}`;
    filterParts.push(
      `[${prevV}][${nextV}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset},format=yuv420p[${vLabel}]`,
      `[${prevA}][${nextA}]acrossfade=d=${fadeDuration}[${aLabel}]`
    );
    cumulativeDuration = offset + durations[i];
    prevV = vLabel;
    prevA = aLabel;
  }
  const filter = normFilter + filterParts.join(';');
  const outPath = outputPath.replace(/\\/g, '/');

  const videoEncode = ['-c:v', useGpu ? GPU_ENCODER.libx264 : 'libx264', '-pix_fmt', 'yuv420p'];
  if (!useGpu) videoEncode.push('-profile:v', 'high', '-level', '4.1', '-preset', 'faster', '-tune', 'film');
  const args = [
    '-y',
    ...inputPaths.flatMap((p) => ['-i', p]),
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-threads', String(threads),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    ...videoEncode, '-map_metadata', '0',
    '-movflags', '+faststart', '-y', outPath,
  ];
  return args;
}

/**
 * Format ffmpeg command for display (quote args that contain spaces).
 */
function formatFfmpegCommand(args) {
  return 'ffmpeg ' + args.map((a) => (a.includes(' ') || a.includes("'") ? `"${String(a).replace(/"/g, '\\"')}"` : a)).join(' ');
}

/**
 * Run ffmpeg with given args; returns a promise that resolves when done.
 * On error, the thrown Error message includes the full command that was run.
 * @param {string[]} args - ffmpeg arguments (without 'ffmpeg' binary).
 * @returns {Promise<void>}
 */
export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (code, signal) => {
      if (code === 0 && !signal) resolve();
      else {
        const reason = signal ? `killed by signal ${signal} (e.g. OOM)` : `exited ${code}`;
        // const cmd = formatFfmpegCommand(args);
        reject(new Error(`ffmpeg ${reason}\n\nStderr (last 1000 chars):\n${stderr.slice(-1000)}`));
      }
    });
  });
}

/**
 * Check whether FFmpeg was built with NVENC (h264_nvenc encoder).
 * Use this when --gpu is requested to fail fast if GPU encode is not available.
 * @returns {Promise<boolean>}
 */
export function isNvencAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-encoders'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('close', (code) => {
      resolve(code === 0 && /h264_nvenc/.test(out));
    });
  });
}
