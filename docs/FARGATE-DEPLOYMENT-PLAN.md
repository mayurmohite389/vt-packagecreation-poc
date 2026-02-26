# Step-by-Step: Docker Image → GitHub → AWS Fargate

This guide covers building your `package-creation-poc` Docker image, storing it in a registry, and running it as an ECS Fargate task.

---

## Overview

1. **Build** the Docker image locally (optional: save to a `.tar` file for transfer or backup).
2. **Push code** to GitHub (if not already there).
3. **Store the image** in a container registry. For Fargate you have two common options:
   - **Option A:** Push image to **Amazon ECR** (recommended for Fargate).
   - **Option B:** Push image to **GitHub Container Registry (ghcr.io)** and allow Fargate to pull from there.
4. **Run** the image on Fargate (ECS cluster, task definition, run task).

Your app already has a `Dockerfile` and `.dockerignore`. Default command is `process` (S3); you can override to `process-local` with args when running the task.

---

## Prerequisites

- **Docker** installed and running.
- **Git** and a **GitHub** account.
- **AWS CLI** installed and configured (`aws configure` with credentials that can create ECR repos, ECS cluster, task definitions, and run tasks).
- (Optional) **GitHub Actions** enabled on the repo if you want CI to build and push the image.

---

## Phase 1: Build the Docker Image

### 1.1 Build locally (validate the Dockerfile)

From the project root (where `Dockerfile` and `package.json` are):

```bash
docker build -t package-creation-poc:latest .
```

Run once to confirm it works:

```bash
docker run --rm package-creation-poc:latest
# Or with S3 process: docker run --rm -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... package-creation-poc:latest process
```

### 1.2 Tag for your registry

- **For Amazon ECR** (replace `ACCOUNT_ID` and `REGION`):

  ```bash
  docker tag package-creation-poc:latest ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/package-creation-poc:latest
  ```

- **For GitHub Container Registry** (replace `YOUR_GITHUB_USER` and optional `YOUR_IMAGE_NAME`):

  ```bash
  docker tag package-creation-poc:latest ghcr.io/YOUR_GITHUB_USER/package-creation-poc:latest
  ```

### 1.3 Save image to a .tar file (optional)

To export the built image as a single `.tar` file (e.g. for transfer, backup, or loading on another machine):

```bash
docker save -o package-creation-poc.tar package-creation-poc:latest
```

- **`-o package-creation-poc.tar`** — output file (use a full path if you want it elsewhere, e.g. `C:\path\to\package-creation-poc.tar`).
- **`package-creation-poc:latest`** — the image name:tag you built in step 1.1.

To load the image from the `.tar` on another machine:

```bash
docker load -i package-creation-poc.tar
```

---

## Phase 2: Push Code to GitHub

### 2.1 Create a repo on GitHub

- GitHub → New repository (e.g. `package-creation-poc` or `PC`).
- Do **not** initialize with README if you already have local code.

### 2.2 Push your code

```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

Use your actual GitHub username and repo name. If the repo already has a remote, just `git push`.

---

## Phase 3: Store the Image in a Registry

Fargate needs to pull the image from a registry. ECR is the standard choice on AWS.

### Option A: Amazon ECR (recommended for Fargate)

#### 3A.1 Create an ECR repository

```bash
aws ecr create-repository --repository-name package-creation-poc --region YOUR_REGION
```

Note the `repositoryUri` in the output (e.g. `123456789012.dkr.ecr.us-east-1.amazonaws.com/package-creation-poc`).

#### 3A.2 Log in Docker to ECR

```bash
aws ecr get-login-password --region YOUR_REGION | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com
```

Replace `ACCOUNT_ID` and `YOUR_REGION`.

#### 3A.3 Build, tag, and push

```bash
docker build -t package-creation-poc:latest .
docker tag package-creation-poc:latest ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/package-creation-poc:latest
docker push ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/package-creation-poc:latest
```

**Optional – build and push from GitHub (CI):**  
Use a GitHub Actions workflow that runs on push (e.g. to `main`), runs `docker build`, logs in to ECR with `aws-actions/amazon-ecr-login`, tags and pushes to the same ECR URI. Then you only push code; the image is built and pushed automatically.

---

### Option B: GitHub Container Registry (ghcr.io)

If you are required to “push the image to GitHub,” this is the image registry (not the code repo).

#### 3B.1 Create a Personal Access Token (PAT)

- GitHub → Settings → Developer settings → Personal access tokens.
- Create a token with scope `write:packages` (and `read:packages` if you need to pull later).

#### 3B.2 Log in Docker to ghcr.io

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

#### 3B.3 Build, tag, and push

```bash
docker build -t package-creation-poc:latest .
docker tag package-creation-poc:latest ghcr.io/YOUR_GITHUB_USER/package-creation-poc:latest
docker push ghcr.io/YOUR_GITHUB_USER/package-creation-poc:latest
```

**Using this image in Fargate:**  
Fargate can pull from public ghcr.io images. For private images, you’ll create an ECS pull-through secret (e.g. store ghcr.io credentials in Secrets Manager) and reference it in the task definition. ECR is simpler if you have no strong requirement for ghcr.io.

---

## Phase 4: Run on AWS Fargate

Fargate is ECS’s serverless compute. You need: a cluster, a task definition (pointing to your image), and then run a task (or use a service).

### 4.1 Create an ECS cluster (if you don’t have one)

```bash
aws ecs create-cluster --cluster-name package-poc-cluster --region YOUR_REGION
```

### 4.2 Create a task execution IAM role (if not already done)

ECS needs a role to pull the image and write logs.

1. IAM → Roles → Create role → Trusted entity: **AWS service** → **Elastic Container Service** → **Elastic Container Service Task**.
2. Attach policies: **AmazonECSTaskExecutionRolePolicy** (and optionally **AmazonSSMReadOnlyAccess** if you use Parameter Store).
3. Name it e.g. `ecsTaskExecutionRole` and create.

### 4.3 Create a task definition

Create a JSON file, e.g. `task-definition.json`:

**If using ECR (Option A):**

```json
{
  "family": "package-creation-poc",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "package-creation-poc",
      "image": "ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/package-creation-poc:latest",
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/package-creation-poc",
          "awslogs-region": "YOUR_REGION"
        }
      },
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ],
      "command": ["process"]
    }
  ]
}
```

**If using ghcr.io (Option B):**  
Change `"image"` to `"ghcr.io/YOUR_GITHUB_USER/package-creation-poc:latest"`. For a private image, add `repositoryCredentials` (Secrets Manager ARN) to the container definition.

**Override command for process-local:**

```json
"command": ["process-local", "--input-paths", "/mnt/efs/input", "--output-path", "/mnt/efs/output"]
```

If you use EFS, add a `volumes` section and `mountPoints` in the container definition.

### 4.4 Create a CloudWatch log group (for awslogs)

```bash
aws logs create-log-group --log-group-name /ecs/package-creation-poc --region YOUR_REGION
```

### 4.5 Create subnets and security group (for awsvpc)

You need at least one VPC with subnets (public or private with NAT) and a security group that allows outbound traffic (for S3, ECR, etc.). Note subnet IDs and security group ID for the next step.

### 4.6 Register the task definition and run a task

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json --region YOUR_REGION
aws ecs run-task \
  --cluster package-poc-cluster \
  --task-definition package-creation-poc \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --region YOUR_REGION
```

Use your actual subnet and security group IDs. For private subnets use `assignPublicIp=DISABLED` and ensure NAT for outbound.

### 4.7 Check the task

```bash
aws ecs list-tasks --cluster package-poc-cluster --region YOUR_REGION
aws ecs describe-tasks --cluster package-poc-cluster --tasks TASK_ARN --region YOUR_REGION
```

View logs in CloudWatch under `/ecs/package-creation-poc`.

---

## Quick reference summary

| Step | Action |
|------|--------|
| 1 | `docker build -t package-creation-poc:latest .` |
| 1b | (Optional) `docker save -o package-creation-poc.tar package-creation-poc:latest` |
| 2 | Push code to GitHub (`git push`) |
| 3 | Create ECR repo (or use ghcr.io), tag image, push |
| 4 | Create ECS cluster, task execution role, log group |
| 5 | Create task definition JSON with your image URI and command |
| 6 | `aws ecs register-task-definition` then `aws ecs run-task` |

---

## Optional: GitHub Actions to build and push to ECR

To build and push the image on every push to `main`:

1. In GitHub repo: Settings → Secrets and variables → Actions. Add:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - (Or use OIDC with AWS for better security.)

2. Add workflow `.github/workflows/build-push-ecr.yml` with content like:

```yaml
name: Build and push to ECR
on:
  push:
    branches: [main]
env:
  ECR_REPOSITORY: package-creation-poc
  AWS_REGION: us-east-1   # set your region
jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Log in to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
```

Add repo secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or use OIDC with AWS). Then your Fargate task definition can use `:latest` or the commit SHA as the image tag.

---

Once this is in place, you build the image (locally or via CI), push it to ECR (or ghcr.io), and run it on Fargate by registering the task definition and running a task (or creating an ECS service for long-running or repeated runs).
