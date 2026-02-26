# Why CPU runs can be faster than GPU runs (TAT)

In the combination reports you may see **CPU TAT lower than GPU TAT**. That is expected with the current defaults. Here’s why.

## What actually uses the GPU today

- **Stitch (fade) step**: Uses **CPU (libx264) only**, even when `--gpu` is set.  
  We deliberately disable GPU for the fade/stitch step because **NVENC + xfade/acrossfade** in a single filter graph often causes **SIGSEGV or OOM** on many servers. So the heaviest part of the pipeline (waterfall of many crossfade jobs) runs on CPU in both “CPU” and “GPU” runs.

- **Crop step** (vertical/aspect-crop): Uses GPU when `--gpu` is set (NVENC encode).  
  Decode and filters (crop, scale) are still on CPU; only the final encode uses the GPU.

- **Gfx overlay step**: Uses GPU when `--gpu` is set (NVENC encode).  
  Again, filters (overlay, etc.) are on CPU; only the encode is on the GPU.

So with **fade enabled** (the default in your combination commands):

- **CPU run** = CPU crop + **CPU stitch (fade)** + CPU gfx  
- **GPU run**  = GPU crop + **CPU stitch (fade)** + GPU gfx  

The stitch step is the same (CPU) in both. Only crop and gfx change. That’s why “GPU” does not mean “everything on GPU.”

## Why GPU runs can be slower overall

1. **Stitch dominates and is always CPU**  
   The fade waterfall (many sequential ffmpeg invocations) is the biggest part of TAT. Since we force CPU there to avoid crashes, that part is identical in both runs. So you’re only comparing GPU vs CPU for crop and gfx, not for the main cost.

2. **GPU usage is encode-only, not full GPU pipeline**  
   We use **CPU decode + CPU filters + NVENC encode**. We do **not** use full GPU graphs (e.g. `scale_cuda`, overlay on GPU). So you get:
   - CPU doing decode and filtering
   - Then copy to GPU and NVENC encode  
   For many short clips or many small jobs, **copy + kernel launch overhead** can make each GPU encode slower than a single libx264 encode on CPU.

3. **Per-invocation overhead**  
   Crop runs once per clip; the waterfall runs once per pair. Each GPU encode has fixed overhead. With many small encodes, that overhead can add up and make the “GPU” run slower end-to-end than the “CPU” run.

So: **ideally** GPU would be faster, but with the current design (stitch forced to CPU + encode-only GPU), **CPU-driven commands can run faster than GPU**, and that’s expected.

## How to try GPU for stitch (horizontal only)

If you want the **stitch (fade) step** to use the GPU encoder for **horizontal** (no aspect crop), you can enable it with **`--gpu-stitch`** together with **`--gpu`**.

- **Vertical (aspect crop / 9:16)**: Stitch **always uses CPU**, even with `--gpu-stitch`. NVENC + xfade with the scaled/cropped vertical pipeline causes SIGSEGV on current setups, so we never use GPU for stitch when aspect crop is enabled.
- **Horizontal (16:9, no crop)**: With **`--gpu --gpu-stitch`**, stitch uses NVENC. On machines where that works, horizontal GPU runs can be faster than CPU.

Summary:

- **Default (no `--gpu-stitch`)**: Stitch = CPU only → CPU runs often faster than GPU.  
- **With `--gpu-stitch`** (and `--gpu`): Stitch = GPU encode **for horizontal only**; vertical still uses CPU for stitch to avoid SIGSEGV.
