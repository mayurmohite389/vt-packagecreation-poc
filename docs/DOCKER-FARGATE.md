# Docker image and Fargate

Build a Docker image of the Package Creation PoC and run it on AWS Fargate (e.g. one task per package via `run-combination-commands-fargate`).

## 1. Build the image

From the project root (where `Dockerfile` is):

```bash
docker build -t package-creation-poc .
```

The image includes:

- **Node.js** and **FFmpeg** (Alpine-based, from `ghcr.io/jrottenberg/ffmpeg`)
- App code: `src/`, `scripts/`, `examples/`, `docs/`
- Default command: `node src/index.js process` (override when running tasks)

## 2. Run locally (optional)

```bash
# Default: process (expects S3 env/args)
docker run --rm package-creation-poc

# Override: process-local with EFS-style paths (if you mount a volume)
docker run --rm -v /path/to/inputs:/opt/live-streams/content/poctest package-creation-poc process-local --input-paths "/opt/live-streams/content/poctest/video.mp4" --output-path /tmp/out.mp4
```

## 3. Push to Amazon ECR for Fargate

1. **Create an ECR repository** (once):

   ```bash
   aws ecr create-repository --repository-name package-creation-poc
   ```

2. **Authenticate Docker to ECR:**

   ```bash
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   ```

3. **Tag and push:**

   ```bash
   export ECR_URI=<account-id>.dkr.ecr.<region>.amazonaws.com/package-creation-poc:latest
   docker tag package-creation-poc:latest $ECR_URI
   docker push $ECR_URI
   ```

Example (replace account and region):

```bash
export AWS_REGION=ap-south-1
export ECR_URI=123456789012.dkr.ecr.ap-south-1.amazonaws.com/package-creation-poc:latest
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin 123456789012.dkr.ecr.$AWS_REGION.amazonaws.com
docker build -t package-creation-poc .
docker tag package-creation-poc:latest $ECR_URI
docker push $ECR_URI
```

## 4. Fargate task definition

Your ECS task definition should:

- Use the **image** from ECR (e.g. `123456789012.dkr.ecr.ap-south-1.amazonaws.com/package-creation-poc:latest`).
- Set **container name** (e.g. `app`) so `run-combination-commands-fargate` can override the command.
- Mount **EFS** (if using `process-local` with paths like `/opt/live-streams/...`) at the same path.
- Grant the task **IAM role** with S3 read/write (and ECR pull for the image).

Example container definition (JSON fragment):

```json
{
  "name": "app",
  "image": "<account>.dkr.ecr.<region>.amazonaws.com/package-creation-poc:latest",
  "essential": true,
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/package-creation-poc",
      "awslogs-region": "<region>"
    }
  },
  "mountPoints": [
    {
      "sourceVolume": "efs",
      "containerPath": "/opt/live-streams",
      "readOnly": false
    }
  ]
}
```

With a volume named `efs` attached to your EFS file system. The task’s **entrypoint** is `node src/index.js`; **command** is overridden per run (e.g. `process-local --gpu --input-paths ...`).

## 5. Run the full combination flow as one Fargate task

To run **download from S3 + run all combination commands** in a **single** Fargate task (same as `npm run run-combination-commands` locally), override the container so it runs the combination script instead of `src/index.js`:

- **Entrypoint:** `node`
- **Command:** `scripts/run-combination-commands.js` (optionally add `docs/combination-commands.json` and `docs/combination-commands-results.txt`)

**Docker (for local test):**
```bash
docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_REGION \
  -v /path/to/efs:/opt/live-streams \
  --entrypoint node \
  package-creation-poc:latest \
  scripts/run-combination-commands.js
```

**AWS CLI (Fargate):** Override the container in the task definition or at run time:

```bash
aws ecs run-task \
  --cluster YOUR_CLUSTER \
  --task-definition YOUR_TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],assignPublicIp=ENABLED}" \
  --overrides '{
    "containerOverrides": [{
      "name": "app",
      "entryPoint": ["node"],
      "command": ["scripts/run-combination-commands.js"]
    }]
  }'
```

Replace `app` with your container name. The task must have EFS mounted at `/opt/live-streams` (so the script can write downloads and process-local can read them) and an IAM role that allows S3 read/write.

## 6. Launch one Fargate task per package

From your machine (or a runner with AWS credentials and the app code):

1. Generate combination commands and write `docs/combination-commands.json` (see [COMMANDS-MULTIPLE-COMBINATIONS.md](COMMANDS-MULTIPLE-COMBINATIONS.md)).
2. Set ECS/container env (or CLI args):
   - `POC_ECS_CLUSTER` – ECS cluster name  
   - `POC_TASK_DEFINITION` – task definition name or ARN  
   - `POC_ECS_CONTAINER_NAME` – container name (e.g. `app`)  
   - Optionally: `POC_SUBNETS`, `POC_SECURITY_GROUPS`
3. Run:

   ```bash
   npm run run-combination-commands-fargate
   ```

Each combination in `combination-commands.json` is run as a separate Fargate task with the same image and EFS mount; the only difference is the overridden command (`node src/index.js process-local ...`).

## 7. GPU (optional)

This image is **CPU-only** (Alpine + standard FFmpeg). For **h264_nvenc** on GPU instances:

- Use a **GPU base image** (e.g. NVIDIA CUDA image or an image with FFmpeg built with `--enable-nvenc`).
- Use **EC2 launch type** with GPU instance types (Fargate does not support GPU as of this writing), or use Fargate with CPU and omit `--gpu`.

If you add a separate Dockerfile (e.g. `Dockerfile.gpu`) for a GPU build, build and push it to another ECR tag (e.g. `package-creation-poc:gpu`) and point the GPU task definition at that image.
