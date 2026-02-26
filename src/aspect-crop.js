/**
 * Per-clip aspect crop from aspect JSON (coordinates per frame).
 * Matches C# ChangeAspectRatioByFilterComplexHQ / CropClip logic.
 */

import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getVideoStreamDetails } from './ffmpeg-builder.js';
import { runFfmpeg } from './ffmpeg-builder.js';
import { FFMPEG_TEMPLATES } from './config.js';
import { DEFAULT_VIDEO_BITRATE, GPU_ENCODER } from './config.js';

/**
 * Load aspect JSON from local path or URL. Returns array of { frame, xMin, xMax, time }.
 * @param {string} pathOrUrl - Local file path or http(s) URL
 * @returns {Promise<Array>}
 */
export async function loadAspectJson(pathOrUrl) {
  const s = String(pathOrUrl || '').trim().replace(/\/\/+/g, '/');
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const res = await fetch(s);
    if (!res.ok) throw new Error(`Aspect JSON fetch failed: ${res.status} ${s}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.frames ? data.frames : [data]);
  }
  const raw = await readFile(s, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.frames ? data.frames : [data]);
}

/**
 * Normalize aspect JSON to sorted list of { frame, minX, maxX, time }.
 * @param {Array<{ frame: number, xMin?: number, xMax?: number, time?: number }>} jsonArray
 * @returns {Array<{ frame: number, minX: number, maxX: number, time: number }>}
 */
export function normalizeAspectJson(jsonArray) {
  if (!Array.isArray(jsonArray) || !jsonArray.length) return [];
  return jsonArray
    .map((s) => ({
      frame: Number(s.frame),
      minX: Number(s.xMin ?? s.minX ?? 0),
      maxX: Number(s.xMax ?? s.maxX ?? 0),
      time: Number(s.time ?? 0),
    }))
    .filter((s) => Number.isFinite(s.frame))
    .sort((a, b) => a.frame - b.frame);
}

/**
 * Build per-frame crop list (liFinalAR) and then filter script string.
 * C# logic: for each frame 1..nb_frames, decide minX/maxX (center before sequence, from seq during, last seq value after).
 */
function buildCropFilterScript(dimensions, aspectSequences, aspectRatio) {
  const { width: inputWidth, height: inputHeight, nb_frames: inputVideoFrames } = dimensions;
  const arNorm = (aspectRatio || '9:16').replace(/\s/g, '').toLowerCase();

  let cropWidth, cropHeight, cropY = 0;
  if (arNorm === '1:1') {
    let cropSize = Math.min(Math.floor(inputWidth), Math.floor(inputHeight));
    if (cropSize % 2 !== 0) cropSize += 1;
    cropWidth = cropSize;
    cropHeight = cropSize;
    if (inputHeight > inputWidth) {
      cropY = Math.round((inputHeight - cropSize) / 2.0 / 2.0) * 2;
    }
  } else if (arNorm === '4:5') {
    cropWidth = Math.ceil(inputHeight * 4.0 / 5.0);
    if (cropWidth % 2 !== 0) cropWidth += 1;
    cropHeight = Math.floor(inputHeight);
  } else {
    // 9:16 default
    cropWidth = Math.ceil(inputHeight * 9.0 / 16.0);
    if (cropWidth % 2 !== 0) cropWidth += 1;
    cropHeight = Math.floor(inputHeight);
  }

  const minSeqFrame = aspectSequences.length ? Math.min(...aspectSequences.map((a) => a.frame)) : 1;
  const maxSeqFrame = aspectSequences.length ? Math.max(...aspectSequences.map((a) => a.frame)) : 0;
  const maxSeqEntry = aspectSequences.length && maxSeqFrame
    ? aspectSequences.find((a) => a.frame === maxSeqFrame)
    : null;
  const maxSeqMinX = maxSeqEntry ? maxSeqEntry.minX : 0;
  const maxSeqMaxX = maxSeqEntry ? maxSeqEntry.maxX : cropWidth;

  const midminx = (inputWidth - cropWidth) / 2.0;
  const midmaxx = midminx + cropWidth;

  const liFinalAR = [];
  let minXPrev = 0, maxXPrev = 0;

  for (let i = 1; i <= inputVideoFrames; i++) {
    if (i < minSeqFrame) {
      liFinalAR.push({ frame: i, minX: midminx, maxX: midmaxx });
      minXPrev = midminx;
      maxXPrev = midmaxx;
    } else if (i >= minSeqFrame && i <= maxSeqFrame) {
      const arobj = aspectSequences.find((a) => a.frame === i);
      if (arobj) {
        liFinalAR.push({ frame: i, minX: arobj.minX, maxX: arobj.maxX });
        minXPrev = arobj.minX;
        maxXPrev = arobj.maxX;
      } else {
        const fallbackMin = minXPrev > 0 ? minXPrev : midminx;
        const fallbackMax = maxXPrev > 0 ? maxXPrev : midmaxx;
        liFinalAR.push({ frame: i, minX: fallbackMin, maxX: fallbackMax });
      }
    } else {
      liFinalAR.push({ frame: i, minX: maxSeqMinX, maxX: maxSeqMaxX });
      minXPrev = maxSeqMinX;
      maxXPrev = maxSeqMaxX;
    }
  }

  // crop x expression: x = if(eq(n,0),minX0)+if(eq(n,1),minX1)+...
  const filtersX = liFinalAR.map((rect) => `if(eq(n\\,${rect.frame - 1})\\,${rect.minX})`);
  const filtersXString = filtersX.join('+');
  const outputResolution = `w=${cropWidth}:h=${cropHeight}`;

  // Scale 9:16 crop output to 1080x1920 so it matches start_plate9_16 / end_plate9_16 and avoids xfade resolution mismatch.
  let upscalefilter = '';
  if (arNorm === '9:16') {
    upscalefilter = ',scale=1080:1920:flags=lanczos';
  }

  const filterScript = `[0:v]crop=${outputResolution}:x=${filtersXString}:y=${cropY}${upscalefilter}[v]`;
  return filterScript;
}

/**
 * Run crop on one clip: read aspect JSON, build filter script, run ffmpeg.
 * @param {string} inputPath - Source clip path
 * @param {string} outputPath - Cropped output path
 * @param {Array<{ frame: number, minX: number, maxX: number }>} aspectSequences - From normalizeAspectJson
 * @param {string} videoBitrate - e.g. '5M'
 * @param {string} aspectRatio - '9:16', '4:5', '1:1'
 * @param {{ useGpu?: boolean }} options - useGpu: use h264_nvenc for encode
 */
export async function runCropClip(inputPath, outputPath, aspectSequences, videoBitrate = DEFAULT_VIDEO_BITRATE, aspectRatio = '9:16', options = {}) {
  const { useGpu = false } = options;
  if (!aspectSequences.length) throw new Error('Aspect sequences required for crop');

  const dimensions = await getVideoStreamDetails(inputPath);
  const filterScript = buildCropFilterScript(dimensions, aspectSequences, aspectRatio);

  const scriptDir = join(tmpdir(), `poc-crop-${randomBytes(6).toString('hex')}`);
  await mkdir(scriptDir, { recursive: true });
  const scriptPath = join(scriptDir, 'crop_script.txt');
  await writeFile(scriptPath, filterScript, 'utf8');

  const input = inputPath.replace(/\\/g, '/');
  const output = outputPath.replace(/\\/g, '/');
  const scriptFile = scriptPath.replace(/\\/g, '/');
  const vb = videoBitrate || DEFAULT_VIDEO_BITRATE;

  const videoEncode = ['-c:v', useGpu ? GPU_ENCODER.libx264 : 'libx264', '-b:v', vb, '-pix_fmt', 'yuv420p'];
  if (!useGpu) videoEncode.push('-profile:v', 'high', '-level', '4.1', '-bf', '2', '-x264-params', 'keyint=100:scenecut=0:bframes=2:ref=4', '-preset', 'faster', '-tune', 'film');
  const args = [
    '-y', '-i', input,
    '-filter_complex_script', scriptFile,
    '-map', '[v]', '-map', '0:a?',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    ...videoEncode, '-map_metadata', '0', '-movflags', '+faststart',
    '-y', output,
  ];
  await runFfmpeg(args);
}
