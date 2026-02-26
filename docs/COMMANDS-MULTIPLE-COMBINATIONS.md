# Commands for Multiple Input Combinations

This document lists **process-local** commands for each combination defined in `horizontal_input_combinations.csv` and `vertical_input_combinations.csv`. The same input file **3508834.mp4** is repeated **Number_Of_Clips** times to produce one stitched package. Graphics and start/end plates are applied per the **Graphic** and **Start_end_plate** columns.

## Running combinations via script (recommended)

Long command lines can hit shell limits. Use the generator and runner so commands live in a JSON file and are executed one by one; each command and its output stats are written to a single results file.

1. **Generate** the commands file from the CSVs and `docs/input files.txt`:
   ```bash
   npm run generate-combination-commands
   ```
   For **GPU** (e.g. g5 with NVENC), add `--gpu` so every command gets `--gpu`:
   ```bash
   npm run generate-combination-commands -- --gpu
   ```
   To generate **only vertical** or **only horizontal** commands:
   ```bash
   npm run generate-combination-commands -- --vertical-only
   npm run generate-combination-commands -- --horizontal-only
   ```
   This writes **`docs/combination-commands.json`** (one entry per combination with `name` and `args`; no long strings passed to the shell).

2. **Run** all commands sequentially and append command + stats to a results file:
   ```bash
   npm run run-combination-commands
   ```
   Default: reads `docs/combination-commands.json`, runs each with `node src/index.js ...args`, and writes **`docs/combination-commands-results.txt`** with a block per run: command line and full output (including TAT/steps JSON).

   Optional arguments:
   ```bash
   node scripts/run-combination-commands.js [path-to-commands.json] [path-to-results.txt]
   ```

At the end you have one file with every command and its output stats together.

---

## Input and output paths (from `input files.txt`)

| Item | Path / value |
|------|----------------|
| Input location | `/opt/live-streams/content/poctest/` |
| Input file | `3508834.mp4` |
| Crop file | `3508834_crop.json` |
| Graphics manifest | `3508834_gfx.json` |
| Start plate (16:9) | `start_plate16_9.mp4` |
| End plate (16:9) | `end_plate16_9.mp4` |
| Start plate (9:16) | `start_plate9_16.mp4` |
| End plate (9:16) | `end_plate9_16.mp4` |
| Output on EFS | `/opt/live-streams/content/poctest/output/` |
| Output on S3 | `s3://si-davs-playgroundvideos/packagetest/` |

Base paths used in commands:

- Input path: `/opt/live-streams/content/poctest/3508834.mp4`
- Gfx manifest: `/opt/live-streams/content/poctest/3508834_gfx.json`
- Horizontal plates: start `/opt/live-streams/content/poctest/start_plate16_9.mp4`, end `/opt/live-streams/content/poctest/end_plate16_9.mp4`
- Vertical plates: start `/opt/live-streams/content/poctest/start_plate9_16.mp4`, end `/opt/live-streams/content/poctest/end_plate9_16.mp4`

---

## 1. Horizontal (16:9) combinations

From `docs/horizontal_input_combinations.csv`.

### 1.1 — 9 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --start-plate /opt/live-streams/content/poctest/start_plate16_9.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate16_9.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_9_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_h_9_gfx_plate.mp4
```

### 1.2 — 4 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --start-plate /opt/live-streams/content/poctest/start_plate16_9.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate16_9.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_4_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_h_4_gfx_plate.mp4
```

### 1.3 — 10 clips, Graphic=FALSE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --start-plate /opt/live-streams/content/poctest/start_plate16_9.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate16_9.mp4 \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_10_no_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_h_10_no_gfx_plate.mp4
```

### 1.4 — 10 clips, Graphic=FALSE, Start_end_plate=FALSE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_10_no_gfx_no_plate.mp4 \
  --s3-output-key packagetest/3508834_h_10_no_gfx_no_plate.mp4
```

### 1.5 — 20 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --start-plate /opt/live-streams/content/poctest/start_plate16_9.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate16_9.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_20_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_h_20_gfx_plate.mp4
```

### 1.6 — 30 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --start-plate /opt/live-streams/content/poctest/start_plate16_9.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate16_9.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_30_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_h_30_gfx_plate.mp4
```

### 1.7 — 30 clips, Graphic=FALSE, Start_end_plate=FALSE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --output-path /opt/live-streams/content/poctest/output/3508834_h_30_no_gfx_no_plate.mp4 \
  --s3-output-key packagetest/3508834_h_30_no_gfx_no_plate.mp4
```

---

## 2. Vertical (9:16) combinations

From `docs/vertical_input_combinations.csv`. Uses 9:16 start/end plates. The input **3508834.mp4** is horizontal, so every vertical combination crops it with **3508834_crop.json** and **--aspect-ratio 9:16**.

### 2.1 — 9 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --start-plate /opt/live-streams/content/poctest/start_plate9_16.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate9_16.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_9_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_v_9_gfx_plate.mp4
```

### 2.2 — 4 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --start-plate /opt/live-streams/content/poctest/start_plate9_16.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate9_16.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_4_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_v_4_gfx_plate.mp4
```

### 2.3 — 10 clips, Graphic=FALSE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --start-plate /opt/live-streams/content/poctest/start_plate9_16.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate9_16.mp4 \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_10_no_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_v_10_no_gfx_plate.mp4
```

### 2.4 — 10 clips, Graphic=FALSE, Start_end_plate=FALSE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_10_no_gfx_no_plate.mp4 \
  --s3-output-key packagetest/3508834_v_10_no_gfx_no_plate.mp4
```

### 2.5 — 12 clips, Graphic=TRUE, Start_end_plate=TRUE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --start-plate /opt/live-streams/content/poctest/start_plate9_16.mp4 \
  --end-plate /opt/live-streams/content/poctest/end_plate9_16.mp4 \
  --gfx-manifest /opt/live-streams/content/poctest/3508834_gfx.json \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_12_gfx_plate.mp4 \
  --s3-output-key packagetest/3508834_v_12_gfx_plate.mp4
```

### 2.6 — 12 clips, Graphic=FALSE, Start_end_plate=FALSE

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4,/opt/live-streams/content/poctest/3508834.mp4" \
  --aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json" \
  --aspect-ratio 9:16 \
  --output-path /opt/live-streams/content/poctest/output/3508834_v_12_no_gfx_no_plate.mp4 \
  --s3-output-key packagetest/3508834_v_12_no_gfx_no_plate.mp4
```

---

## 3. Optional flags

- **GPU:** Add `--gpu` to use NVENC (e.g. on g5 instances).
- **No fade:** Add `--no-fade` for concat-only (no xfade).
- **Resolution:** Add `--resolution 1920:1080` (or desired W:H) to scale output.
- **Aspect crop:** Add `--aspect-json-paths "/opt/live-streams/content/poctest/3508834_crop.json"` and `--aspect-ratio 9:16` (or `4:5`, `1:1`) when using per-frame crop.

---

## 4. Output naming summary

| Combination | EFS output | S3 key |
|-------------|------------|--------|
| Horizontal 9 clips, gfx, plate | `3508834_h_9_gfx_plate.mp4` | `packagetest/3508834_h_9_gfx_plate.mp4` |
| Horizontal 4 clips, gfx, plate | `3508834_h_4_gfx_plate.mp4` | `packagetest/3508834_h_4_gfx_plate.mp4` |
| Horizontal 10 clips, no gfx, plate | `3508834_h_10_no_gfx_plate.mp4` | `packagetest/3508834_h_10_no_gfx_plate.mp4` |
| Horizontal 10 clips, no gfx, no plate | `3508834_h_10_no_gfx_no_plate.mp4` | `packagetest/3508834_h_10_no_gfx_no_plate.mp4` |
| Horizontal 20 clips, gfx, plate | `3508834_h_20_gfx_plate.mp4` | `packagetest/3508834_h_20_gfx_plate.mp4` |
| Horizontal 30 clips, gfx, plate | `3508834_h_30_gfx_plate.mp4` | `packagetest/3508834_h_30_gfx_plate.mp4` |
| Horizontal 30 clips, no gfx, no plate | `3508834_h_30_no_gfx_no_plate.mp4` | `packagetest/3508834_h_30_no_gfx_no_plate.mp4` |
| Vertical 9 clips, gfx, plate | `3508834_v_9_gfx_plate.mp4` | `packagetest/3508834_v_9_gfx_plate.mp4` |
| Vertical 4 clips, gfx, plate | `3508834_v_4_gfx_plate.mp4` | `packagetest/3508834_v_4_gfx_plate.mp4` |
| Vertical 10 clips, no gfx, plate | `3508834_v_10_no_gfx_plate.mp4` | `packagetest/3508834_v_10_no_gfx_plate.mp4` |
| Vertical 10 clips, no gfx, no plate | `3508834_v_10_no_gfx_no_plate.mp4` | `packagetest/3508834_v_10_no_gfx_no_plate.mp4` |
| Vertical 12 clips, gfx, plate | `3508834_v_12_gfx_plate.mp4` | `packagetest/3508834_v_12_gfx_plate.mp4` |
| Vertical 12 clips, no gfx, no plate | `3508834_v_12_no_gfx_no_plate.mp4` | `packagetest/3508834_v_12_no_gfx_no_plate.mp4` |

All outputs are under `/opt/live-streams/content/poctest/output/` on EFS and `s3://si-davs-playgroundvideos/packagetest/` on S3.
