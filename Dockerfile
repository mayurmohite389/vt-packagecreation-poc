# Package Creation PoC: Node + FFmpeg for video stitching. For Fargate: build, push to ECR, run as ECS task.
# Supports process (S3) and process-local (EFS paths); Fargate typically overrides CMD to process-local ... per package.
FROM ghcr.io/jrottenberg/ffmpeg:8-alpine

RUN apk add --no-cache nodejs npm && node -v

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY examples ./examples
COPY docs ./docs

# Default: process (S3). Override at run: e.g. CMD ["process-local", "--gpu", "--input-paths", "...", ...]
ENV NODE_ENV=production
ENTRYPOINT ["node", "src/index.js"]
CMD ["process"]
