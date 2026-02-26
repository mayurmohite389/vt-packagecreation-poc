# Package Creation PoC

Proof of concept for the package engine HLD: evaluate compute options for video stitching with S3 and optional Fargate.

## What it does

- **Download** input videos from S3
- **Stitch** with concat (no fade) or with **fade transitions** (filter_complex + xfade)
- **Upload** the final video to S3
- **Measure TAT** (total time for download + ffmpeg + upload)
- **Option: GPU** — use `h264_nvenc` instead of `libx264` when `--gpu` is set (run on GPU-capable instance/container)
- **Batching (fade)** — clips are processed in batches (e.g. 12 per batch), each batch xfade-joined to a temp file, then batch outputs joined (C#-style); use `--batch-size N` or set to 0 for no batching
- **Resolution** — optional `--resolution W:H` (e.g. `608:1080`, `1280:720`) to scale all inputs before fade
- **Plates by order** — start/end plates and content order via `--start-plate` / `--end-plate` or a JSON manifest with `clipType` and `orderId`
- **Graphics overlay** — after stitching, overlay image sequences or static images at given time ranges via `--gfx-manifest` (JSON: `markIn`, `markOut`, `gfx_type` 1=sequence / 2=static, `imagePath` or `imagePattern`, `fps`); same logic as C# StitchImageSequenceHQNew
- **Per-clip aspect crop** — if an aspect JSON path/URL is provided for a clip, that clip is cropped first (per-frame coordinates from JSON, aspect ratio 9:16 / 4:5 / 1:1), then all clips are merged; same logic as C# CropClip / ChangeAspectRatioByFilterComplexHQ
- **Measure Fargate task start time** — run a Fargate task and report time until status is RUNNING

## Prerequisites

- Node.js 18+
- FFmpeg (and ffprobe) on `PATH`
- AWS credentials only when using S3 or Fargate

## Install

```bash
npm install
```

## Test locally (no S3)

Use **process-local** with local video files so you don’t need AWS or a bucket:

1. **Install FFmpeg** (if needed):
   - Windows: `winget install FFmpeg` or download from https://ffmpeg.org
   - Or use Chocolatey: `choco install ffmpeg`
2. **Run with 2+ local clips** (paths with spaces are OK in env; in CLI use quotes):

```bash
# Stitch with fade (default), output to output.mp4
node src/index.js process-local --input-paths "C:\path\to\clip1.mp4,C:\path\to\clip2.mp4" --output-path output.mp4

# No fade (concat only)
node src/index.js process-local --input-paths "clip1.mp4,clip2.mp4" --no-fade --output-path out.mp4

# With start/end plates (order: start plate, then content, then end plate)
node src/index.js process-local --start-plate start.mp4 --input-paths "c1.mp4,c2.mp4" --end-plate end.mp4 --output-path out.mp4

# Plate order by manifest (clipType + orderId)
node src/index.js process-local --input-manifest examples/input-manifest.example.json --output-path out.mp4

# Fade with batching (e.g. 12 clips per batch) and resolution
node src/index.js process-local --input-paths "c1.mp4,...,c30.mp4" --batch-size 12 --resolution 608:1080 --output-path out.mp4

# With graphics overlay (static image and/or image sequence; applied after stitch)
node src/index.js process-local --input-paths "c1.mp4,c2.mp4" --output-path out.mp4 --gfx-manifest examples/gfx-manifest.example.json

# With per-clip aspect crop (crop clip 1 using aspect JSON, then merge)
node src/index.js process-local --input-paths "c1.mp4,c2.mp4" --aspect-json-paths "D:/aspect/clip1.json," --output-path out.mp4 --aspect-ratio 9:16
```

Using env (e.g. in PowerShell):

```powershell
$env:POC_INPUT_PATHS = "clip1.mp4,clip2.mp4"
$env:POC_OUTPUT_PATH = "output.mp4"
node src/index.js process-local
```

You’ll get JSON with `tatMs` and per-step timings (`downloadMs: 0`, `ffmpegMs`, `uploadMs: 0`) and the stitched file at `output-path`.

## Usage

### Process videos (with S3, measure TAT)

```bash
# Fade transition (default), CPU
node src/index.js process --bucket MY_BUCKET --input-keys "clips/a.mp4,clips/b.mp4,clips/c.mp4" --output-key outputs/stitched.mp4

# No fade (concat), CPU
node src/index.js process --bucket MY_BUCKET --input-keys "clips/a.mp4,clips/b.mp4" --output-key outputs/out.mp4 --no-fade

# With GPU encoder (use on instances with NVIDIA GPU)
node src/index.js process --bucket MY_BUCKET --input-keys "clips/a.mp4,clips/b.mp4" --output-key outputs/out.mp4 --gpu

# Fade with batching and resolution (order keys: start plate, content, end plate)
node src/index.js process --bucket MY_BUCKET --input-keys "plates/start.mp4,clips/1.mp4,clips/2.mp4,plates/end.mp4" --output-key out.mp4 --batch-size 12 --resolution 608:1080
```

Environment variables (optional): `POC_BUCKET`, `POC_INPUT_KEYS`, `POC_OUTPUT_KEY`, `POC_BATCH_SIZE`, `POC_RESOLUTION`.

### Measure Fargate task start time

```bash
node src/index.js measure-fargate --cluster my-cluster --task-definition my-task:1 --subnets "subnet-xxx,subnet-yyy" --security-groups "sg-xxx"
```

Or set: `POC_ECS_CLUSTER`, `POC_TASK_DEFINITION`, `POC_SUBNETS`, `POC_SECURITY_GROUPS`.

### Test parameters (for evaluation matrix)

The app is designed to be run against these dimensions:

| Parameter        | Values              |
|-----------------|---------------------|
| Package duration| 4, 10, 15, 30 min   |
| Number of clips | 4, 10, 30, 60       |
| Graphic         | Yes / No            |
| Start plate     | Yes / No            |
| End plate       | Yes / No            |

Use different input key sets and durations to cover the matrix. Output includes `tatMs` and per-step timings (`downloadMs`, `ffmpegMs`, `uploadMs`).

## Docker (Fargate)

Uses a **thin FFmpeg layer** (Alpine-based image with FFmpeg 7.1).

```bash
docker build -t package-creation-poc .
docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_REGION \
  -e POC_BUCKET -e POC_INPUT_KEYS -e POC_OUTPUT_KEY \
  package-creation-poc process
```

For ECS/Fargate: push image to ECR, create a task definition that runs this image with the same env vars and IAM role for S3 (and optional GPU capacity if using `--gpu`).

## FFmpeg commands

- **No fade**: concat demuxer (`PackageNoFadeCommandHQ`) — single `-f concat -safe 0 -i list.txt` and encode.
- **Fade**: multiple `-i` inputs and `filter_complex` with `xfade` + `acrossfade` (`PackageFadeCommandHQ`).

Both support swapping `libx264` for `h264_nvenc` when `--gpu` is used.
