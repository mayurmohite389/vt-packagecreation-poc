/**
 * Orchestrates: download from S3 -> stitch (concat or fade, with batching) -> upload to S3.
 * Measures TAT and per-step timings.
 * Supports plate ordering by clipType/orderId and optional resolution scaling.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as s3 from './s3.js';
import {
  buildConcatList,
  buildNoFadeArgs,
  buildFadeArgs,
  runFfmpeg,
  getDuration,
  getInputClipDetails,
} from './ffmpeg-builder.js';
import { runGfxOverlay } from './gfx-builder.js';
import { normalizeOverlaySequences } from './gfx-builder.js';
import { loadAspectJson, normalizeAspectJson, runCropClip } from './aspect-crop.js';
import { VIDEO_COUNT_FOR_PACKAGE_BATCH, VIDEO_COUNT_FOR_PACKAGE_BATCH_ASPECT_CROP, PACKAGE_SCALE_FPS_VERTICAL } from './config.js';

/**
 * Run fade join on one set of paths (2 inputs, 1 xfade) and write to outputPath. Returns path and duration.
 */
async function runFadeJoin(inputPaths, outputPath, options) {
  const durations = await Promise.all(inputPaths.map((p) => getDuration(p)));
  const args = buildFadeArgs(inputPaths, durations, outputPath, options);
  await runFfmpeg(args);
  const duration = await getDuration(outputPath);
  return { path: outputPath, duration };
}

/**
 * Waterfall: pairwise crossfade so FFmpeg never has more than 2 inputs (avoids xfade/acrossfade OOM).
 * Step 1: fade path[0] + path[1] -> temp_1; Step 2: fade temp_1 + path[2] -> temp_2; ... final -> outputPath.
 */
async function runFadeJoinWaterfall(pathsToMerge, outputPath, workDir, options) {
  if (pathsToMerge.length === 0) return;
  if (pathsToMerge.length === 1) {
    const args = buildFadeArgs(pathsToMerge, [await getDuration(pathsToMerge[0])], outputPath, options);
    await runFfmpeg(args);
    return;
  }
  let currentPath = pathsToMerge[0];
  for (let i = 1; i < pathsToMerge.length; i++) {
    const isLast = i === pathsToMerge.length - 1;
    const tempOut = isLast ? outputPath : join(workDir, `waterfall_${i}.mp4`);
    await runFadeJoin([currentPath, pathsToMerge[i]], tempOut, options);
    currentPath = tempOut;
  }
}

/**
 * Log ffprobe details for each stitch input to stdout (captured in result file for debugging mismatches).
 */
function logStitchInputDetails(paths, clipDetails) {
  // console.log('\n--- Stitch input details (ffprobe) ---');
  // console.log('Count:', paths.length);
  // clipDetails.forEach((d, i) => {
  //   const name = paths[i].split('/').pop() || paths[i];
  //   console.log(`\n[${i}] ${name}`);
  //   if (d.video) {
  //     console.log('  video:', `${d.video.width}x${d.video.height}`, 'r_frame_rate:', d.video.r_frame_rate, 'time_base:', d.video.time_base, 'pix_fmt:', d.video.pix_fmt, 'codec:', d.video.codec_name);
  //   } else console.log('  video: (none)');
  //   if (d.audio) {
  //     console.log('  audio:', 'sample_rate:', d.audio.sample_rate, 'channels:', d.audio.channels, 'codec:', d.audio.codec_name, 'time_base:', d.audio.time_base);
  //   } else console.log('  audio: (none)');
  //   console.log('  duration:', d.duration != null ? `${d.duration.toFixed(2)}s` : '(unknown)');
  // });
  // console.log('\n----------------------------------------\n');
}

/**
 * For each clip that has an aspect JSON path/URL, crop it and return the list of paths to merge (cropped or original).
 */
async function resolvePathsWithAspectCrop(orderedPaths, aspectJsonPaths, workDir, videoBitrate, aspectRatio, useGpu = false) {
  if (!aspectJsonPaths?.length || aspectJsonPaths.every((p) => !p)) return orderedPaths;
  const pathsToMerge = [];
  for (let i = 0; i < orderedPaths.length; i++) {
    const pathOrUrl = aspectJsonPaths[i];
    if (pathOrUrl) {
      const raw = await loadAspectJson(pathOrUrl);
      const sequences = normalizeAspectJson(raw);
      if (!sequences.length) {
        pathsToMerge.push(orderedPaths[i]);
        continue;
      }
      const croppedPath = join(workDir, `crop_${i}.mp4`);
      await runCropClip(orderedPaths[i], croppedPath, sequences, videoBitrate, aspectRatio, { useGpu });
      pathsToMerge.push(croppedPath);
    } else {
      pathsToMerge.push(orderedPaths[i]);
    }
  }
  return pathsToMerge;
}

/**
 * Process videos using local files only (no S3). For local testing.
 * orderedPaths: already ordered (start_plate, content by orderId, end_plate).
 */
export async function processVideosLocal(options) {
  const {
    orderedPaths,
    outputPath,
    useFade = false,
    useGpu = false,
    useGpuForStitch = false,
    videoBitrate = '5M',
    fadeDuration = 1,
    videoCountForPackageBatch = VIDEO_COUNT_FOR_PACKAGE_BATCH,
    packageResolution = '',
    gfxSequences = [],
    aspectJsonPaths = [],
    aspectRatio = '9:16',
  } = options;

  const t0 = Date.now();
  const downloadMs = 0;
  const overlaySequences = normalizeOverlaySequences(gfxSequences);
  const hasGfx = overlaySequences.length > 0;
  const hasAspectCrop = aspectJsonPaths?.length > 0 && aspectJsonPaths.some((p) => p);
  const stitchWorkDir = (useFade || hasGfx || hasAspectCrop) ? await mkdtemp(join(tmpdir(), 'poc-local-')) : null;
  const stitchOutput = hasGfx ? join(stitchWorkDir, 'stitched.mp4') : outputPath;

  const pathsToMerge = hasAspectCrop
    ? await resolvePathsWithAspectCrop(orderedPaths, aspectJsonPaths, stitchWorkDir, videoBitrate, aspectRatio, useGpu)
    : orderedPaths;

  // When aspect crop: normalize to 1080x1920, fps=50, settb=AVTB (avoids xfade timebase/SIGSEGV), and xfade safety buffer.
  // Fade/stitch: never use GPU when hasAspectCrop (vertical); NVENC + xfade with crop causes SIGSEGV. Horizontal can use --gpu-stitch.
  const stitchUseGpu = useFade ? (useGpuForStitch && useGpu && !hasAspectCrop) : useGpu;
  const effectiveResolution = packageResolution || (hasAspectCrop ? '1080:1920' : '');
  const ffmpegOptions = {
    useGpu: stitchUseGpu,
    fadeDuration,
    packageResolution: effectiveResolution || undefined,
    ...(hasAspectCrop && { packageFps: PACKAGE_SCALE_FPS_VERTICAL }),
  };

  // Log ffprobe details for all inputs about to be stitched (appears in result file for debugging mismatches).
  try {
    const clipDetails = await Promise.all(pathsToMerge.map((p) => getInputClipDetails(p)));
    logStitchInputDetails(pathsToMerge, clipDetails);
  } catch (e) {
    console.warn('Could not probe stitch inputs:', e.message);
  }

  if (useFade) {
    const workDir = stitchWorkDir;
    try {
      const ffmpegStart = Date.now();
      await runFadeJoinWaterfall(pathsToMerge, stitchOutput, workDir, ffmpegOptions);
      let ffmpegMs = Date.now() - ffmpegStart;
      let gfxMs = 0;
      if (hasGfx) {
        const gfxStart = Date.now();
        await runGfxOverlay(stitchOutput, overlaySequences, outputPath, { useGpu });
        gfxMs = Date.now() - gfxStart;
      }
      const tatMs = Date.now() - t0;
      return { tatMs, steps: { downloadMs, ffmpegMs, gfxMs, uploadMs: 0 }, outputPath };
    } finally {
      if (stitchWorkDir) await rm(stitchWorkDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const { listPath } = await buildConcatList(pathsToMerge);
  const ffmpegArgs = buildNoFadeArgs(listPath, stitchOutput, { useGpu, videoBitrate });
  const ffmpegStart = Date.now();
  await runFfmpeg(ffmpegArgs);
  let ffmpegMs = Date.now() - ffmpegStart;
  let gfxMs = 0;
  if (hasGfx) {
    const gfxStart = Date.now();
    await runGfxOverlay(stitchOutput, overlaySequences, outputPath, { useGpu });
    gfxMs = Date.now() - gfxStart;
  }
  const tatMs = Date.now() - t0;
  if (stitchWorkDir) await rm(stitchWorkDir, { recursive: true, force: true }).catch(() => {});
  return { tatMs, steps: { downloadMs, ffmpegMs, gfxMs, uploadMs: 0 }, outputPath };
}

/**
 * Process videos: download from S3, stitch with or without fade (with batching), upload to S3.
 * inputKeys must be in desired order (start plate, content, end plate) or use inputManifest for plate ordering.
 */
export async function processVideos(options) {
  const {
    bucket,
    inputKeys,
    outputKey,
    useFade = false,
    useGpu = false,
    useGpuForStitch = false,
    videoBitrate = '5M',
    fadeDuration = 1,
    videoCountForPackageBatch = VIDEO_COUNT_FOR_PACKAGE_BATCH,
    packageResolution = '',
    gfxSequences = [],
    aspectJsonPaths = [],
    aspectRatio = '9:16',
  } = options;

  const actualWorkDir = await mkdtemp(join(tmpdir(), 'poc-'));
  const overlaySequences = normalizeOverlaySequences(gfxSequences);
  const hasGfx = overlaySequences.length > 0;
  const stitchPath = join(actualWorkDir, 'stitched.mp4');
  const outputPath = join(actualWorkDir, 'output.mp4');

  try {
    const t0 = Date.now();
    const downloadStart = Date.now();
    const localPaths = await s3.downloadObjects(bucket, inputKeys, join(actualWorkDir, 'inputs'));
    const downloadMs = Date.now() - downloadStart;
    const orderedPaths = localPaths;
    const hasAspectCrop = aspectJsonPaths?.length > 0 && aspectJsonPaths.some((p) => p);
    const pathsToMerge = hasAspectCrop
      ? await resolvePathsWithAspectCrop(orderedPaths, aspectJsonPaths, actualWorkDir, videoBitrate, aspectRatio, useGpu)
      : orderedPaths;

    // Fade/stitch: never use GPU when hasAspectCrop (vertical); NVENC + xfade with crop causes SIGSEGV.
    const stitchUseGpu = useFade ? (useGpuForStitch && useGpu && !hasAspectCrop) : useGpu;
    const effectiveResolution = packageResolution || (hasAspectCrop ? '1080:1920' : '');
    const ffmpegOptions = {
      useGpu: stitchUseGpu,
      fadeDuration,
      packageResolution: effectiveResolution || undefined,
      ...(hasAspectCrop && { packageFps: PACKAGE_SCALE_FPS_VERTICAL }),
    };
    const writePath = hasGfx ? stitchPath : outputPath;

    try {
      const clipDetails = await Promise.all(pathsToMerge.map((p) => getInputClipDetails(p)));
      logStitchInputDetails(pathsToMerge, clipDetails);
    } catch (e) {
      console.warn('Could not probe stitch inputs:', e.message);
    }

    if (useFade) {
      const ffmpegStart = Date.now();
      await runFadeJoinWaterfall(pathsToMerge, writePath, actualWorkDir, ffmpegOptions);
      let ffmpegMs = Date.now() - ffmpegStart;
      let gfxMs = 0;
      if (hasGfx) {
        const gfxStart = Date.now();
        await runGfxOverlay(stitchPath, overlaySequences, outputPath, { useGpu });
        gfxMs = Date.now() - gfxStart;
      }
      const uploadStart = Date.now();
      await s3.uploadFile(bucket, outputKey, outputPath);
      const uploadMs = Date.now() - uploadStart;
      const tatMs = Date.now() - t0;
      return { tatMs, steps: { downloadMs, ffmpegMs, gfxMs, uploadMs }, outputPath };
    }

    const { listPath } = await buildConcatList(pathsToMerge);
    const ffmpegArgs = buildNoFadeArgs(listPath, writePath, { useGpu, videoBitrate });
    const ffmpegStart = Date.now();
    await runFfmpeg(ffmpegArgs);
    let ffmpegMs = Date.now() - ffmpegStart;
    let gfxMs = 0;
    if (hasGfx) {
      const gfxStart = Date.now();
      await runGfxOverlay(stitchPath, overlaySequences, outputPath, { useGpu });
      gfxMs = Date.now() - gfxStart;
    }
    const uploadStart = Date.now();
    await s3.uploadFile(bucket, outputKey, outputPath);
    const uploadMs = Date.now() - uploadStart;
    const tatMs = Date.now() - t0;
    return { tatMs, steps: { downloadMs, ffmpegMs, gfxMs, uploadMs }, outputPath };
  } finally {
    await rm(actualWorkDir, { recursive: true, force: true }).catch(() => {});
  }
}
