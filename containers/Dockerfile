FROM node:24-bookworm-slim
ARG CODEX_VERSION
ARG CLAUDE_VERSION
RUN test -n "$CODEX_VERSION" && test -n "$CLAUDE_VERSION"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
    && npm cache clean --force
ENV HOME=/home/agent
WORKDIR /workspace
USER 1000:1000
CMD ["sleep", "infinity"]
