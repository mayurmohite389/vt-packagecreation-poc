# Deploy and Test Package Creation PoC on g5.4xlarge (Linux)

This guide walks through deploying and testing the Package Creation PoC on an AWS **g5.4xlarge** Linux instance. The default S3 destination is **s3://si-davs-playgroundvideos/packagetest/**.

---

## 1. Prerequisites

### 1.1 EC2 instance

- **Instance type:** g5.4xlarge (NVIDIA A10G GPU; use `--gpu` for h264_nvenc).
- **AMI:** Amazon Linux 2 or Amazon Linux 2023, or Ubuntu 22.04 LTS.
- **Storage:** Enough EBS for input videos, temp files, and output (e.g. 50–100 GB).
- **Security group:** Allow SSH (22) from your IP.
- **IAM:** Instance profile with S3 read/write to `si-davs-playgroundvideos` (or attach a role after launch).

### 1.2 From your Windows machine

- SSH client (PowerShell/OpenSSH or PuTTY).
- Your `.pem` key for the instance.
- FileZilla (or another SFTP client) to copy the published folder to the server.

---

## 2. Launch and connect

### 2.1 Launch g5.4xlarge

1. In EC2 Console: **Launch instance**.
2. **Name:** e.g. `package-creation-poc`.
3. **AMI:** Amazon Linux 2 or Ubuntu 22.04.
4. **Instance type:** g5.4xlarge.
5. **Key pair:** Select or create a `.pem` key; download and store it (e.g. `C:\keys\my-key.pem`).
6. **Network:** Default VPC or your choice; **Auto-assign public IP** enabled.
7. **Storage:** e.g. 50 GB gp3.
8. **Advanced → IAM instance profile:** Attach a role that has S3 access to `si-davs-playgroundvideos` (or add credentials later).
9. Launch the instance.

### 2.2 Get the public hostname

In EC2 Console → **Instances** → select the instance → copy **Public IPv4 DNS** (e.g. `ec2-xx-xx-xx-xx.compute-1.amazonaws.com`).

### 2.3 Connect via SSH (PowerShell on Windows)

```powershell
# Set key and host (use your path and hostname)
$key = "C:\path\to\your-key.pem"
$host = "ec2-user@ec2-xx-xx-xx-xx.compute-1.amazonaws.com"

# Amazon Linux 2 / AL2023
ssh -i $key $host

# If Ubuntu, use user "ubuntu"
# $host = "ubuntu@ec2-xx-xx-xx-xx.compute-1.amazonaws.com"
# ssh -i $key $host
```

You should be logged in to the Linux instance.

---

## 3. Install dependencies on the instance

Run these on the **g5.4xlarge** (after SSH).

**Choose the right subsection:**  
- **Ubuntu** (prompt `ubuntu@...`) → use **section 3.2** and **`apt`**. Do **not** use `dnf`; you will get `dnf: command not found`.  
- **Amazon Linux** (prompt `ec2-user@...`) → use **section 3.1** and **`dnf`**.

---

### 3.1 Amazon Linux 2 / 2023

**Only if your prompt shows `ec2-user` or `amazon-linux`.** Amazon Linux uses **`dnf`** (not apt).

```bash
# Node.js 18
sudo dnf install -y gcc-c++ make
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs

# FFmpeg
sudo dnf install -y ffmpeg

# Verify
node -v    # v18.x or higher
npm -v
ffmpeg -version
ffprobe -version
```

### 3.2 Ubuntu (22.04, 24.04, etc.)

**Only if your prompt shows `ubuntu@...`.** Ubuntu uses **`apt`** (not dnf). If you see `sudo: dnf: command not found`, you are on Ubuntu — use the commands below instead.

```bash
sudo apt update
sudo apt install -y curl

# Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# FFmpeg
sudo apt install -y ffmpeg

# Verify
node -v
npm -v
ffmpeg -version
ffprobe -version
```

### 3.3 (Optional) GPU / NVIDIA drivers for `--gpu`

To use **h264_nvenc** (faster encode on A10G):

- **Amazon Linux:** Use an AMI with NVIDIA drivers pre-installed (e.g. “NVIDIA”-qualified AMI) or install the NVIDIA driver and ensure `ffmpeg` is built with `--enable-nvenc` (your distro’s `ffmpeg` may not include it; you may need a custom build or a container image that includes it).
- If `ffmpeg` does not support NVENC, omit `--gpu` and the app will use CPU (libx264).

**How the app ensures GPU is used:**

1. **Encoder:** When you pass `--gpu`, the app uses `-c:v h264_nvenc` instead of `-c:v libx264` in all FFmpeg commands (stitch, crop, gfx).
2. **Startup check:** Before running, the app runs `ffmpeg -encoders` and checks for `h264_nvenc`. If it’s missing, the app exits with a clear error instead of failing mid-run.
3. **Runtime check (optional):** While a job is running, open another SSH session and run `nvidia-smi` (or `watch -n 1 nvidia-smi`). You should see GPU utilization and memory use when FFmpeg is encoding.

Check for NVENC:

```bash
ffmpeg -encoders 2>/dev/null | grep nvenc
```

If you see `h264_nvenc`, you can use `--gpu`.

---

## 4. Deploy the application (manual copy via FileZilla)

No Git or clone. You **publish** a folder on your PC and copy it to the server with FileZilla, then run `npm install` on the server.

### 4.1 Prepare the folder on your PC (publish)

Node doesn’t compile to DLLs like C#. This project has a **publish script** that builds a clean folder (no `node_modules`, no `.git`) ready to copy — similar in spirit to a .NET publish output.

**Option A – Use the publish script (recommended)**

In the project directory on your PC (e.g. `D:\POC\PackageCreation`):

```powershell
npm run publish
```

This creates a **`publish`** folder in the project with:

- `package.json` (and `package-lock.json` if present)
- `src/`
- `examples/`
- `docs/`
- `README.md`

It does **not** include `node_modules` or `.git`. Copy the **`publish`** folder to the server via FileZilla, then on the server run `npm install` in that folder.

**Option B – Manual copy**

1. Copy the project folder, then delete in the copy: `node_modules`, `.git`.
2. Or zip the project excluding `node_modules` and `.git`, upload the zip, then on the server unzip and run `npm install`.

### 4.2 Copy to the server with FileZilla

1. Open **FileZilla**.
2. **Host:** your instance’s public IP or DNS (e.g. `ec2-xx-xx-xx-xx.compute-1.amazonaws.com`).
3. **Username:** `ubuntu` (Ubuntu) or `ec2-user` (Amazon Linux).
4. **Password:** leave empty if you use key-based login. For key auth in FileZilla: **Edit → Settings → Connection → SFTP** → add your `.pem` key; or use SSH agent.
5. **Port:** 22.
6. Connect, then drag your **published folder** (or zip) from the local pane to the remote pane (e.g. `/home/ubuntu/` or `~/`).
7. If you uploaded a zip, on the server you will unzip it (see below).

### 4.3 On the server: unpack (if zip) and install dependencies

SSH into the instance, then:

```bash
# If you uploaded a zip (replace with your zip name)
cd ~
unzip PackageCreation.zip -d PackageCreation
cd PackageCreation

# If you uploaded a folder, just go into it
cd ~/PackageCreation-publish   # or whatever name you gave the folder

# Install dependencies (required; do not skip)
npm install
```

After this, the app is ready to run (see section 6).

---

## 5. Configure AWS and S3

### 5.1 IAM role (recommended)

If the instance has an IAM role with S3 access to `si-davs-playgroundvideos`, no keys are needed. Verify:

```bash
aws sts get-caller-identity
aws s3 ls s3://si-davs-playgroundvideos/
```

### 5.2 Or use access keys

If not using a role:

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

To make them persistent for your user, add the same lines to `~/.bashrc` and run `source ~/.bashrc`.

---

## 6. Run tests

All commands below are run **on the g5.4xlarge** in the project directory (the folder you copied via FileZilla, e.g. `~/PackageCreation` or `~/PackageCreation-publish`). The default S3 destination is **s3://si-davs-playgroundvideos/packagetest/** (bucket and output prefix are set in config).

### 6.1 Test 1: Process from S3 (default destination, CPU)

Input keys must exist in the same bucket (or ensure the role can read that bucket/prefix).

```bash
cd ~/PackageCreation   # or your project folder name

node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4"
```

- **Downloads** from `s3://si-davs-playgroundvideos/` for the given keys.
- **Stitches** with fade (default).
- **Uploads** to `s3://si-davs-playgroundvideos/packagetest/stitched-<timestamp>.mp4`.

Output includes **tatMs** and **steps** (downloadMs, ffmpegMs, gfxMs, uploadMs).

### 6.2 Test 2: Process from S3 with GPU

If your FFmpeg supports NVENC:

```bash
node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4" --gpu
```

### 6.3 Test 3: No fade (concat only)

```bash
node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4" --no-fade
```

### 6.4 Test 4: Custom output key under packagetest

```bash
node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4" --output-key packagetest/my-test-001.mp4
```

### 6.5 Test 5: Process-local (no S3, for quick validation)

Use paths to files that exist on the instance (e.g. under `/tmp` or home):

```bash
node src/index.js process-local --input-paths "/tmp/clip1.mp4,/tmp/clip2.mp4" --output-path /tmp/out.mp4
```

With GPU:

```bash
node src/index.js process-local --input-paths "/tmp/clip1.mp4,/tmp/clip2.mp4" --output-path /tmp/out.mp4 --gpu
```

### 6.6 Test 6: Process-local with S3 upload (write to EFS, then upload to bucket)

Write the stitched file to a local/EFS path, then upload it to S3 in the same run. Use **`--s3-output-key`** (and optionally **`--s3-bucket`**). Default bucket is `si-davs-playgroundvideos`. S3 region defaults to **ap-south-1** unless **`AWS_REGION`** or **`AWS_DEFAULT_REGION`** is set.

```bash
node src/index.js process-local \
  --input-paths "/opt/live-streams/content/poctest/3003686.mp4,/opt/live-streams/content/poctest/3003686.mp4" \
  --output-path /opt/live-streams/content/poctest/3003686_p1.mp4 \
  --s3-output-key packagetest/3003686_p1.mp4
```

Result: file on EFS at `--output-path` and a copy at **s3://si-davs-playgroundvideos/packagetest/3003686_p1.mp4**. Stats include `uploadMs`.

Custom bucket:

```bash
node src/index.js process-local --input-paths "c1.mp4,c2.mp4" --output-path /var/efs/out.mp4 --s3-output-key path/out.mp4 --s3-bucket my-bucket
```

### 6.7 Test 7: Dry run (S3, no encode)

Verifies CLI and S3 keys without running FFmpeg:

```bash
node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4" --dry-run
```

---

## 7. Read the stats (time taken)

Every run prints JSON with timing:

- **tatMs** – total time (all steps).
- **steps.downloadMs** – time to download inputs from S3.
- **steps.ffmpegMs** – time to create the package (stitch).
- **steps.gfxMs** – time for graphics overlay (0 if none).
- **steps.uploadMs** – time to upload the final file to S3.

Example:

```json
{
  "tatMs": 120000,
  "steps": {
    "downloadMs": 10000,
    "ffmpegMs": 90000,
    "gfxMs": 0,
    "uploadMs": 20000
  },
  "outputKey": "packagetest/stitched-1234567890.mp4"
}
```

Save to a file:

```bash
node src/index.js process --input-keys "packagetest/inputs/clip1.mp4,packagetest/inputs/clip2.mp4" 2>&1 | tee run.log
```

Then inspect `run.log` for the JSON block and the “TAT” line.

---

## 8. Verify output in S3

From the instance:

```bash
aws s3 ls s3://si-davs-playgroundvideos/packagetest/
```

Download a stitched file to check playback:

```bash
aws s3 cp s3://si-davs-playgroundvideos/packagetest/stitched-<timestamp>.mp4 /tmp/stitched.mp4
```

---

## 9. Optional: Run in background or as a service

### 9.1 One-off in background

```bash
nohup node src/index.js process --input-keys "packagetest/inputs/c1.mp4,packagetest/inputs/c2.mp4" --gpu > /tmp/poc.log 2>&1 &
tail -f /tmp/poc.log
```

### 9.2 systemd service (Amazon Linux / Ubuntu)

Replace `ec2-user` and paths if your user or path differs.

```bash
sudo tee /etc/systemd/system/package-creation-poc.service << 'EOF'
[Unit]
Description=Package Creation PoC
After=network.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/PackageCreation
# Change User and path if you use ec2-user or a different folder name.
Environment="AWS_REGION=us-east-1"
ExecStart=/usr/bin/node src/index.js process --input-keys "YOUR_INPUT_KEYS" --gpu
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
# Run once:
sudo systemctl start package-creation-poc
# Check:
sudo journalctl -u package-creation-poc -f
```

For recurring runs, use a cron job or a wrapper script that calls the same `node ... process` command with the desired keys.

---

## 10. Checklist summary

| Step | Action |
|------|--------|
| 1 | Launch g5.4xlarge (Amazon Linux 2/2023 or Ubuntu 22.04), attach IAM role with S3 access. |
| 2 | SSH: `ssh -i key.pem ec2-user@<public-dns>`. |
| 3 | Install Node 18+ and FFmpeg (see section 3). |
| 4 | Copy published folder to server via FileZilla; on server run `npm install`. |
| 5 | Ensure AWS credentials (role or env vars). |
| 6 | Run `node src/index.js process --input-keys "packagetest/inputs/..."` (add `--gpu` if NVENC available). |
| 7 | Read stats from JSON in output (tatMs, steps.*). |
| 8 | Verify output in s3://si-davs-playgroundvideos/packagetest/. |

---

## 11. Troubleshooting

| Issue | What to do |
|-------|------------|
| `ENOENT ffprobe` | Install FFmpeg: `sudo dnf install -y ffmpeg` or `sudo apt install -y ffmpeg`. |
| S3 Access Denied | Check IAM role or env vars; ensure role has `s3:GetObject`, `s3:PutObject` on `si-davs-playgroundvideos`. |
| Out of disk | Increase EBS size or clean `/tmp`; ensure enough space for inputs + output. |
| `--gpu` fails or unknown encoder | Run without `--gpu` (CPU encode), or install/build FFmpeg with NVENC support. |
| Input key not found | Confirm keys exist: `aws s3 ls s3://si-davs-playgroundvideos/packagetest/inputs/`. |

---

**Document version:** 1.0  
**Default S3 destination:** s3://si-davs-playgroundvideos/packagetest/
