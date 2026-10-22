# Agent Replay backend — FastAPI service + Node recorder in one image.
#
# The recorder needs Node >= 22.12 (for `node:sqlite` and ESM), and the
# evaluation tasks run `node --test`, so the image is based on the official
# Node 22 image and adds Python 3 + git on top.
FROM node:22-slim

# Pass a host proxy through at build time if the host needs one (e.g. Clash):
#   docker build --build-arg HTTP_PROXY=http://host.docker.internal:7890 \
#                --build-arg HTTPS_PROXY=http://host.docker.internal:7890 .
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    NO_PROXY=localhost,127.0.0.1

# git is required by the recorder (baseline/diff/patch) and the evaluator.
# python3 + pip run the FastAPI service and the experiment harness.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        python3 \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (leverages layer cache).
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Install Node dependencies and build the recorder CLI bundle.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:cli

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5)" || exit 1

# The agent CLI itself (e.g. opencode) is intentionally NOT installed in the
# image: real agent runs require the user's own credentials. Mount them at run
# time if you need /tasks/{id}/run to execute an agent (see README).
CMD ["uvicorn", "agent_replay.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
