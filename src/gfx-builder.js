/**
 * Graphic overlay: stitch image sequence or static images onto a base video.
 * Matches C# StitchImageSequenceHQNew logic (GfxCommandHQ).
 * gfx_type: 1 = image sequence (pattern e.g. frame_%04d.png), 2 = static image.
 */

import { runFfmpeg } from './ffmpeg-builder.js';
import { GPU_ENCODER } from './config.js';

/**
 * Normalize overlay sequence items (sort by markIn, compute duration).
 * @param {Array<{ markIn: number|string, markOut: number|string, gfx_type?: number, imagePath?: string, imagePattern?: string, fps?: string }>} items
 * @returns {Array<{ markIn: number, markOut: number, durationInSeconds: number, gfx_type: number, imagePath?: string, imagePattern?: string, fps: string }>}
 */
export function normalizeOverlaySequences(items) {
  if (!items?.length) return [];
  const normalized = items
    .filter((a) => a != null && (a.markIn != null || a.mark_in != null))
    .map((a) => {
      const markIn = Number(a.markIn ?? a.mark_in);
      const markOut = Number(a.markOut ?? a.mark_out);
      const gfx_type = Number(a.gfx_type) || 1;
      const fps = (a.fps != null && String(a.fps).trim()) ? String(a.fps).trim() : '25';
      const durationInSeconds = Math.max(0, markOut - markIn);
      return {
        markIn,
        markOut,
        durationInSeconds,
        gfx_type,
        fps,
        imagePath: a.imagePath ?? a.graphics_thumbnail_path,
        imagePattern: a.imagePattern ?? (a.png_base_url && a.image_pattern ? `${a.png_base_url}${a.image_pattern}` : a.image_pattern),
      };
    })
    .sort((a, b) => a.markIn - b.markIn);
  return normalized;
}

/**
 * Build ffmpeg arguments for graphic overlay (single or multiple overlays).
 * Base video is [0:v]; overlay inputs start at [1:v], [2:v], ...
 * options.useGpu: use h264_nvenc for encode (avoids libx264 SIGSEGV on some setups).
 */
export function buildGfxArgs(inputVideo, overlaySequences, outputPath, options = {}) {
  const { useGpu = false } = options;
  const input = inputVideo.replace(/\\/g, '/');
  const output = outputPath.replace(/\\/g, '/');
  const seq = overlaySequences;

  const baseSetpts = '[0:v]setpts=PTS-STARTPTS[base];';
  const imgSeqArgs = [];
  let setpts = '';
  let filter = '';
  let current = 'base';
  let outLabel = 'out';

  if (seq.length === 1) {
    const item = seq[0];
    if (item.gfx_type === 2 && item.imagePath) {
      imgSeqArgs.push('-loop', '1', '-t', String(item.durationInSeconds), '-i', item.imagePath.replace(/\\/g, '/'));
      setpts = `[1:v]setpts=PTS-STARTPTS+${item.markIn}/TB[seq1];`;
    } else if (item.imagePattern) {
      imgSeqArgs.push('-framerate', item.fps, '-i', item.imagePattern.replace(/\\/g, '/'));
      setpts = `[1:v]setpts=PTS-STARTPTS+${item.markIn}/TB[seq1];`;
    }
    filter = '[base][seq1]overlay=0:0[out]';
  } else {
    for (let j = 1; j <= seq.length; j++) {
      const item = seq[j - 1];
      const isLast = j === seq.length;
      const nextLabel = isLast ? 'out' : `v${j}`;

      if (item.gfx_type === 2 && item.imagePath) {
        imgSeqArgs.push('-loop', '1', '-t', String(item.durationInSeconds), '-i', item.imagePath.replace(/\\/g, '/'));
        setpts += `[${j}:v]setpts=PTS-STARTPTS+${item.markIn}/TB[seq${j}];`;
      } else if (item.imagePattern) {
        imgSeqArgs.push('-framerate', item.fps, '-i', item.imagePattern.replace(/\\/g, '/'));
        setpts += `[${j}:v]fps=${item.fps},trim=duration=${item.durationInSeconds},setpts=PTS-STARTPTS+${item.markIn}/TB[seq${j}];`;
      }

      filter += `[${current}][seq${j}]overlay=0:0[${nextLabel}];`;
      current = nextLabel;
      outLabel = nextLabel;
    }
  }

  const filterComplex = baseSetpts + setpts + filter;
  const videoEncode = ['-c:v', useGpu ? GPU_ENCODER.libx264 : 'libx264', '-pix_fmt', 'yuv420p'];
  if (!useGpu) videoEncode.push('-profile:v', 'high', '-level', '4.1', '-bf', '2', '-x264-params', 'keyint=100:scenecut=0:bframes=2:ref=4', '-preset', 'faster', '-tune', 'film');
  return [
    '-y', '-i', input,
    ...imgSeqArgs,
    '-filter_complex', filterComplex,
    '-map', `[${outLabel}]`, '-map', '0:a?',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-map', '0:s?',
    ...videoEncode, '-map_metadata', '0', '-movflags', '+faststart',
    '-y', output,
  ];
}

/**
 * Run graphic overlay: base video + overlay sequences -> output video.
 * @param {string} inputVideo - Path to stitched base video
 * @param {Array} overlaySequences - Normalized overlay list (use normalizeOverlaySequences first)
 * @param {string} outputPath - Final output path
 * @param {{ useGpu?: boolean }} options - useGpu: use NVENC for encode (can avoid libx264 SIGSEGV)
 */
export async function runGfxOverlay(inputVideo, overlaySequences, outputPath, options = {}) {
  if (!overlaySequences.length) return;
  const args = buildGfxArgs(inputVideo, overlaySequences, outputPath, options);
  await runFfmpeg(args);
}
