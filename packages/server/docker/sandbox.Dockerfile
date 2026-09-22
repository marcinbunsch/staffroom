# The image the Docker sandbox runs. Build it before enabling the sandbox:
#
#   pnpm sandbox:build
#
# (equivalently: docker build -t staffroom-sandbox:latest -f packages/server/docker/sandbox.Dockerfile .)
#
# Override the tag with STAFFROOM_SANDBOX_IMAGE. The daemon probe checks this
# image exists locally, so the sandbox toolset is simply not offered until it does.
#
# python3 / git / ripgrep / jq are the tools the agent is told to use to narrow
# large results and to clone the read-only repo mirrors from /repos into /work.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*
