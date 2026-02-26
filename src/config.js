/**
 * PoC configuration: test parameters and ffmpeg command templates.
 */

export const TEST_PARAMS = {
  /** Package total duration in minutes */
  durations: [4, 10, 15, 30],
  /** Number of clips to stitch */
  clipCounts: [4, 10, 30, 60],
  /** Include graphic overlay (placeholder for future) */
  graphic: true,
  /** Include start plate video (first clip is a "slate") */
  startPlate: true,
  /** Include end plate video (last clip is a "slate") */
  endPlate: true,
};

/** FFmpeg command templates (placeholders: [input], [output], [filter], [map], [videobitrate], [threads], [imgseq], [out]) */
export const FFMPEG_TEMPLATES = {
  PackageNoFadeCommandHQ:
    '-y -f concat -safe 0 -i "[input]" [videobitrate] -map 0:v:0 -map 0:a:0 -c:a aac -b:a 192k -ar 48000 -ac 2 -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -preset faster -tune film -map_metadata 0 -movflags +faststart "[output]"',
  PackageFadeCommandHQ:
    '-y [input] -filter_complex "[filter]" [map] -threads [threads] -c:a aac -b:a 192k -ar 48000 -ac 2 -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -preset faster -tune film -map_metadata 0 -movflags +faststart -y "[output]"',
  /** Graphic overlay: single or multiple overlays; placeholders [input], [imgseq], [filter], [out], [output] */
  GfxCommandHQ:
    '-y -i "[input]" [imgseq] -filter_complex "[filter]" -map [out] -map 0:a? -c:a aac -b:a 192k -ar 48000 -ac 2 -map 0:s? -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -bf 2 -x264-params keyint=100:scenecut=0:bframes=2:ref=4 -preset faster -tune film -map_metadata 0 -movflags +faststart -y "[output]"',
  /** Per-clip aspect crop; placeholders [input], [scriptfile], [videobitrate], [output] */
  CropCommandHQ:
    '-y -i "[input]" -filter_complex_script "[scriptfile]" -map "[v]" -map 0:a? -c:a aac -b:a 192k -ar 48000 -ac 2 -c:v libx264 [videobitrate] -profile:v high -level 4.1 -pix_fmt yuv420p -bf 2 -x264-params keyint=100:scenecut=0:bframes=2:ref=4 -preset faster -tune film -map_metadata 0 -movflags +faststart -y "[output]"',
};

/** GPU encoder swap (when useGpu: use NVENC instead of libx264) */
export const GPU_ENCODER = {
  libx264: 'h264_nvenc',
  // NVENC common options: -preset p4 -tune hq (or leave default)
};

/** Default video bitrate for HQ */
export const DEFAULT_VIDEO_BITRATE = '5M';

/** Default fade duration in seconds */
export const DEFAULT_FADE_DURATION = 1;

/** Safety buffer (seconds) before end of clip so xfade does not run past the last frame (avoids SIGSEGV). ~6 frames at 50fps. */
export const XFADE_SAFETY_BUFFER_SECONDS = 0.12;

/** Batch size for fade path (clips per batch before final join); match C# VideoCountForPackageBatch */
export const VIDEO_COUNT_FOR_PACKAGE_BATCH = 12;

/** Batch size when aspect crop is used (fade path now uses waterfall; this is for API/CLI default only). */
export const VIDEO_COUNT_FOR_PACKAGE_BATCH_ASPECT_CROP = 12;

/** FPS used when scaling to package_resolution (default for horizontal/non-crop). */
export const PACKAGE_SCALE_FPS = 25;

/** FPS used when normalizing stitch inputs for vertical (aspect crop); match plate and content (e.g. 50). */
export const PACKAGE_SCALE_FPS_VERTICAL = 50;

/** Default S3 destination for package output (bucket + prefix) */
export const DEFAULT_S3_BUCKET = 'si-davs-playgroundvideos';
export const DEFAULT_S3_OUTPUT_PREFIX = 'packagetest/';
