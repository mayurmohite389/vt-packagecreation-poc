# Alignment: Node PoC vs Original C# Code

## Do we need to align?

**For this PoC, full alignment is not required.** The goal is to evaluate compute options (TAT, Fargate start time, GPU vs CPU) for video stitching. Using the same FFmpeg templates and the same high-level behavior (concat vs xfade) is enough to get comparable workload and timings.

**You would want closer alignment if** you plan to replace the C# service with Node or need to compare C# vs Node runtimes on identical behavior (e.g. batching, resolution).

---

## What matches

| Area | C# | Node PoC |
|------|----|----------|
| **FFmpeg templates** | `PackageNoFadeCommandHQ`, `PackageFadeCommandHQ` | Same strings in `config.js` |
| **No-fade** | Concat list `file 'path'`, replace `[input]` `[output]` `[videobitrate]` | Same concat list format and args |
| **Fade offset math** | `Offset = VideoDuration + PrevOffset - FadeDuration` | Same: `offset = cumulativeDuration - fadeDuration` |
| **Fade filter** | xfade + acrossfade, `format=yuv420p` on last | xfade + acrossfade, format=yuv420p |
| **Start/end plates** | Injected in code (prepend start, append end) | Order by `--start-plate` / `--end-plate` or manifest `clipType` + `orderId` |
| **Batching** | Fade path: batches of N (e.g. 12), xfade each batch → temp, then xfade batch outputs; merge last single into previous batch | Same: `--batch-size N`, merge last single clip into previous batch |
| **Resolution/scale** | Optional `package_resolution` with `scale=...,fps=25` before xfade | `--resolution W:H` (e.g. `608:1080`), scale+fps before xfade |

---

## What still differs

| Feature | C# | Node PoC |
|---------|----|----------|
| **Plates in fade path** | Can run `ApplyStartEndPlateVideoToSourceVideo` after main join. | Plates are first/last in the ordered list (no separate post-step). |
| **Single clip (no-fade)** | `File.Copy` only. | Full concat with one file. |
| **Single clip (fade)** | Not used (fade needs ≥2). | Re-encode single file to match output codec. |

---

## Summary

- **Templates, concat, fade, batching, resolution, and plate ordering** are aligned with the C# behavior.
- Remaining differences: no separate “apply start/end plate after join” step; single-clip handling is slightly different.
