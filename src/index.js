#!/usr/bin/env node
/**
 * PoC CLI: process videos (with TAT), or measure Fargate task start time.
 * Test parameters: duration, clip count, graphic, start/end plate via env or args.
 */

import { readFile } from 'fs/promises';
import { processVideos, processVideosLocal } from './processor.js';
import { isNvencAvailable } from './ffmpeg-builder.js';
import * as s3 from './s3.js';
import { measureFargateTaskStartTime } from './ecs-fargate.js';
import { sortByPlateOrder, sortManifestByPlateOrder, buildOrderedPaths } from './plate-order.js';
import { TEST_PARAMS, VIDEO_COUNT_FOR_PACKAGE_BATCH, DEFAULT_S3_BUCKET, DEFAULT_S3_OUTPUT_PREFIX } from './config.js';

const usage = `
Usage:
  node src/index.js process [options]
    Process videos from S3: download -> stitch (fade or no-fade) -> upload. Reports TAT.

  node src/index.js process-local [options]
    Same stitching using LOCAL files only (no S3). Use this to test locally.

  node src/index.js measure-fargate [options]
    Run a Fargate task and measure time until task reaches RUNNING.

Options (process):
  --bucket <name>           S3 bucket (default: env POC_BUCKET)
  --input-keys <k1,k2,...>  Comma-separated S3 keys (order: start plate, content, end plate)
  --output-key <key>        S3 key for stitched output (default: outputs/stitched-<timestamp>.mp4)
  --no-fade                 Use concat (no fade); default is fade
  --gpu                     Use GPU encoder (h264_nvenc) when available
  --gpu-stitch              With --gpu, also use GPU for fade/stitch (default: off; can cause SIGSEGV on some setups)
  --batch-size <n>          Fade: clips per batch (default: ${VIDEO_COUNT_FOR_PACKAGE_BATCH}); 0 = no batching
  --resolution <W:H>        Optional scale before fade e.g. 608:1080 or 1280:720
  --gfx-manifest <file>     JSON: graphics overlay (markIn, markOut, gfx_type, imagePath/imagePattern, fps)
  --aspect-json-paths <..>  Comma-separated aspect JSON path/URL per clip (empty = no crop)
  --aspect-ratio <ratio>    9:16, 4:5, 1:1 (default: 9:16)
  --dry-run                 Only print what would be done, do not run ffmpeg/S3

Options (process-local):
  --input-paths <p1,p2,...> Local paths (content clips, order preserved)
  --input-manifest <file>   JSON file: [{"path":"...","clipType":"start_plate|content|end_plate","orderId":1},...]
  --start-plate <path>      Prepend this as start plate (ignored if using --input-manifest)
  --end-plate <path>        Append this as end plate (ignored if using --input-manifest)
  --output-path <path>      Local path for stitched output (default: ./output.mp4)
  --no-fade                 Use concat (no fade); default is fade
  --gpu                     Use GPU encoder when available
  --gpu-stitch              With --gpu, also use GPU for fade/stitch (default: off; can cause SIGSEGV on some setups)
  --batch-size <n>          Fade: clips per batch (default: ${VIDEO_COUNT_FOR_PACKAGE_BATCH})
  --resolution <W:H>        Optional scale before fade e.g. 608:1080
  --gfx-manifest <file>     JSON: overlay graphics (markIn, markOut, gfx_type 1=sequence 2=static, imagePath/imagePattern, fps)
  --aspect-json-paths <..>  Comma-separated aspect JSON path/URL per clip (empty = no crop)
  --aspect-ratio <ratio>    9:16, 4:5, 1:1 (default: 9:16)
  --s3-output-key <key>      After writing to EFS/local, upload output to this S3 key (bucket from --s3-bucket or default)
  --s3-bucket <name>        Bucket for upload when using --s3-output-key (default: si-davs-playgroundvideos)

Options (measure-fargate):
  --cluster <name>          ECS cluster (default: env POC_ECS_CLUSTER)
  --task-definition <name>  Task definition (default: env POC_TASK_DEFINITION)
  --subnets <id1,id2>       Comma-separated subnet IDs (default: env POC_SUBNETS)
  --security-groups <id>    Security group ID (default: env POC_SECURITY_GROUPS)

Test parameters (for reference / future matrix runs):
  Durations: ${TEST_PARAMS.durations.join(', ')} min
  Clip counts: ${TEST_PARAMS.clipCounts.join(', ')}
  Graphic: ${TEST_PARAMS.graphic}, Start plate: ${TEST_PARAMS.startPlate}, End plate: ${TEST_PARAMS.endPlate}
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bucket' && args[i + 1]) { options.bucket = args[++i]; continue; }
    if (args[i] === '--input-keys' && args[i + 1]) { options.inputKeys = args[++i].split(',').map((k) => k.trim()); continue; }
    if (args[i] === '--output-key' && args[i + 1]) { options.outputKey = args[++i]; continue; }
    if (args[i] === '--no-fade') { options.noFade = true; continue; }
    if (args[i] === '--gpu') { options.gpu = true; continue; }
    if (args[i] === '--gpu-stitch') { options.gpuStitch = true; continue; }
    if (args[i] === '--dry-run') { options.dryRun = true; continue; }
    if (args[i] === '--cluster' && args[i + 1]) { options.cluster = args[++i]; continue; }
    if (args[i] === '--task-definition' && args[i + 1]) { options.taskDefinition = args[++i]; continue; }
    if (args[i] === '--subnets' && args[i + 1]) { options.subnets = args[++i].split(',').map((s) => s.trim()); continue; }
    if (args[i] === '--security-groups' && args[i + 1]) { options.securityGroups = args[++i].split(',').map((s) => s.trim()); continue; }
    if (args[i] === '--input-paths' && args[i + 1]) { options.inputPaths = args[++i].split(',').map((k) => k.trim()); continue; }
    if (args[i] === '--input-manifest' && args[i + 1]) { options.inputManifest = args[++i]; continue; }
    if (args[i] === '--start-plate' && args[i + 1]) { options.startPlate = args[++i]; continue; }
    if (args[i] === '--end-plate' && args[i + 1]) { options.endPlate = args[++i]; continue; }
    if (args[i] === '--output-path' && args[i + 1]) { options.outputPath = args[++i]; continue; }
    if (args[i] === '--batch-size' && args[i + 1]) { options.batchSize = parseInt(args[++i], 10) || 0; continue; }
    if (args[i] === '--resolution' && args[i + 1]) { options.resolution = args[++i]; continue; }
    if (args[i] === '--gfx-manifest' && args[i + 1]) { options.gfxManifest = args[++i]; continue; }
    if (args[i] === '--aspect-json-paths' && args[i + 1]) { options.aspectJsonPaths = args[++i].split(',').map((s) => s.trim() || null); continue; }
    if (args[i] === '--aspect-ratio' && args[i + 1]) { options.aspectRatio = args[++i]; continue; }
    if (args[i] === '--s3-output-key' && args[i + 1]) { options.s3OutputKey = args[++i]; continue; }
    if (args[i] === '--s3-bucket' && args[i + 1]) { options.s3Bucket = args[++i]; continue; }
    if (args[i] === 'process' || args[i] === 'process-local' || args[i] === 'measure-fargate') { options.command = args[i]; continue; }
  }
  return options;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.command === 'process') {
    const bucket = opts.bucket || process.env.POC_BUCKET || DEFAULT_S3_BUCKET;
    const inputKeys = opts.inputKeys || (process.env.POC_INPUT_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const outputKey = opts.outputKey || process.env.POC_OUTPUT_KEY || `${DEFAULT_S3_OUTPUT_PREFIX}stitched-${Date.now()}.mp4`;
    const useFade = !opts.noFade;
    const useGpu = !!opts.gpu;
    const dryRun = !!opts.dryRun;

    if (!inputKeys.length) {
      console.error('Missing --input-keys (or set POC_INPUT_KEYS). Bucket defaults to ' + bucket + ', output to s3://' + bucket + '/' + DEFAULT_S3_OUTPUT_PREFIX);
      console.error(usage);
      process.exit(1);
    }

    if (dryRun) {
      const batchSize = opts.batchSize != null ? opts.batchSize : (process.env.POC_BATCH_SIZE ? parseInt(process.env.POC_BATCH_SIZE, 10) : VIDEO_COUNT_FOR_PACKAGE_BATCH);
      console.log('Dry run: would process', inputKeys.length, 'inputs from s3://' + bucket + '/');
      console.log('  useFade:', useFade, 'useGpu:', useGpu, 'batchSize:', batchSize, 'resolution:', opts.resolution || process.env.POC_RESOLUTION || '(none)', 'outputKey:', outputKey);
      process.exit(0);
    }

    if (useGpu) {
      const nvencOk = await isNvencAvailable();
      if (!nvencOk) {
        console.error('--gpu was set but FFmpeg does not report h264_nvenc. Install FFmpeg with NVENC support and ensure NVIDIA drivers are loaded.');
        console.error('Run: ffmpeg -encoders | grep nvenc');
        process.exit(1);
      }
    }

    const batchSize = opts.batchSize != null ? opts.batchSize : (process.env.POC_BATCH_SIZE ? parseInt(process.env.POC_BATCH_SIZE, 10) : VIDEO_COUNT_FOR_PACKAGE_BATCH);
    const resolution = opts.resolution || process.env.POC_RESOLUTION || '';
    let gfxSequences = [];
    if (opts.gfxManifest || process.env.POC_GFX_MANIFEST) {
      const gfxPath = opts.gfxManifest || process.env.POC_GFX_MANIFEST;
      const raw = await readFile(gfxPath, 'utf8');
      const data = JSON.parse(raw);
      gfxSequences = Array.isArray(data) ? data : (data.overlays ? data.overlays : [data]);
    }

    const t0 = Date.now();
    const aspectJsonPaths = opts.aspectJsonPaths ?? (process.env.POC_ASPECT_JSON_PATHS ? process.env.POC_ASPECT_JSON_PATHS.split(',').map((s) => s.trim() || null) : []);
    const aspectRatio = opts.aspectRatio || process.env.POC_ASPECT_RATIO || '9:16';

    const result = await processVideos({
      bucket,
      inputKeys,
      outputKey,
      useFade,
      useGpu,
      useGpuForStitch: !!opts.gpuStitch,
      videoCountForPackageBatch: batchSize,
      packageResolution: resolution,
      gfxSequences,
      aspectJsonPaths: aspectJsonPaths.length ? aspectJsonPaths.slice(0, inputKeys.length) : [],
      aspectRatio,
    });
    const totalWall = Date.now() - t0;

    console.log(JSON.stringify({
      tatMs: result.tatMs,
      totalWallMs: totalWall,
      steps: result.steps,
      outputKey,
    }, null, 2));
    console.log('TAT (total time for all steps):', result.tatMs, 'ms');
    return;
  }

  if (opts.command === 'process-local') {
    let orderedPaths;
    let aspectJsonPaths = opts.aspectJsonPaths ?? (process.env.POC_ASPECT_JSON_PATHS ? process.env.POC_ASPECT_JSON_PATHS.split(',').map((s) => s.trim() || null) : []);
    if (opts.inputManifest) {
      const raw = await readFile(opts.inputManifest, 'utf8');
      const manifest = JSON.parse(raw);
      const arr = Array.isArray(manifest) ? manifest : [manifest];
      const sorted = sortManifestByPlateOrder(arr);
      orderedPaths = sorted.map((i) => i.path);
      aspectJsonPaths = sorted.map((i) => i.aspectJsonPath ?? null);
    } else {
      const contentPaths = opts.inputPaths || (process.env.POC_INPUT_PATHS || '').split(',').map((k) => k.trim()).filter(Boolean);
      orderedPaths = buildOrderedPaths(contentPaths, {
        startPlate: opts.startPlate || process.env.POC_START_PLATE,
        endPlate: opts.endPlate || process.env.POC_END_PLATE,
      });
      if (aspectJsonPaths.length && aspectJsonPaths.length !== orderedPaths.length) {
        const padded = [...aspectJsonPaths];
        while (padded.length < orderedPaths.length) padded.push(null);
        aspectJsonPaths = padded.slice(0, orderedPaths.length);
      }
    }
    const outputPath = opts.outputPath || process.env.POC_OUTPUT_PATH || 'output.mp4';
    const useFade = !opts.noFade;
    const useGpu = !!opts.gpu;
    const batchSize = opts.batchSize != null ? opts.batchSize : (process.env.POC_BATCH_SIZE ? parseInt(process.env.POC_BATCH_SIZE, 10) : VIDEO_COUNT_FOR_PACKAGE_BATCH);
    const resolution = opts.resolution || process.env.POC_RESOLUTION || '';
    const aspectRatio = opts.aspectRatio || process.env.POC_ASPECT_RATIO || '9:16';

    if (!orderedPaths.length) {
      console.error('Missing inputs: use --input-paths, or --input-manifest, or POC_INPUT_PATHS');
      console.error(usage);
      process.exit(1);
    }

    if (useGpu) {
      const nvencOk = await isNvencAvailable();
      if (!nvencOk) {
        console.error('--gpu was set but FFmpeg does not report h264_nvenc. Install FFmpeg with NVENC support and ensure NVIDIA drivers are loaded.');
        console.error('Run: ffmpeg -encoders | grep nvenc');
        process.exit(1);
      }
    }

    let gfxSequences = [];
    if (opts.gfxManifest || process.env.POC_GFX_MANIFEST) {
      const gfxPath = opts.gfxManifest || process.env.POC_GFX_MANIFEST;
      const raw = await readFile(gfxPath, 'utf8');
      const data = JSON.parse(raw);
      gfxSequences = Array.isArray(data) ? data : (data.overlays ? data.overlays : [data]);
    }

    const result = await processVideosLocal({
      orderedPaths,
      outputPath,
      useFade,
      useGpu,
      useGpuForStitch: !!opts.gpuStitch,
      videoCountForPackageBatch: batchSize,
      packageResolution: resolution,
      gfxSequences,
      aspectJsonPaths: aspectJsonPaths.length ? aspectJsonPaths : [],
      aspectRatio,
    });

    let uploadMs = 0;
    let s3OutputKey = opts.s3OutputKey || process.env.POC_S3_OUTPUT_KEY;
    if (s3OutputKey) {
      const bucket = opts.s3Bucket || process.env.POC_S3_BUCKET || DEFAULT_S3_BUCKET;
      const uploadStart = Date.now();
      await s3.uploadFile(bucket, s3OutputKey, result.outputPath);
      uploadMs = Date.now() - uploadStart;
      console.log(JSON.stringify({
        tatMs: result.tatMs,
        steps: { ...result.steps, uploadMs },
        outputPath: result.outputPath,
        s3Uri: `s3://${bucket}/${s3OutputKey}`,
      }, null, 2));
      console.log('TAT (stitch):', result.tatMs, 'ms | Upload to S3:', uploadMs, 'ms');
      console.log('Output on EFS:', result.outputPath);
      console.log('Output on S3:', `s3://${bucket}/${s3OutputKey}`);
    } else {
      console.log(JSON.stringify({
        tatMs: result.tatMs,
        steps: result.steps,
        outputPath: result.outputPath,
      }, null, 2));
      console.log('TAT (stitch only, no S3):', result.tatMs, 'ms');
      console.log('Output written to:', result.outputPath);
    }
    return;
  }

  if (opts.command === 'measure-fargate') {
    const cluster = opts.cluster || process.env.POC_ECS_CLUSTER;
    const taskDefinition = opts.taskDefinition || process.env.POC_TASK_DEFINITION;
    const subnets = opts.subnets?.length ? opts.subnets : (process.env.POC_SUBNETS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const securityGroups = opts.securityGroups?.length ? opts.securityGroups : (process.env.POC_SECURITY_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);

    if (!cluster || !taskDefinition) {
      console.error('Missing --cluster and/or --task-definition (or set POC_ECS_CLUSTER, POC_TASK_DEFINITION)');
      console.error(usage);
      process.exit(1);
    }

    const startMs = await measureFargateTaskStartTime({
      cluster,
      taskDefinition,
      subnets,
      securityGroups,
    });
    console.log(JSON.stringify({ fargateTaskStartMs: startMs }, null, 2));
    console.log('Fargate task start time:', startMs, 'ms');
    return;
  }

  console.error(usage);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
