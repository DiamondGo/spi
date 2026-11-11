FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates xvfb xauth x11-utils python3 libglib2.0-bin libgtk-3-0 libnss3 libnspr4 libgbm1 \
    libasound2 libx11-xcb1 libxss1 libxshmfence1 libdrm2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:$PATH
USER node
RUN npm install --global --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.5.0 \
    && npm cache clean --force
WORKDIR /home/node
COPY --chown=node:node scripts/with-display.cjs scripts/portable-smoke.cjs scripts/smoke.cjs scripts/gui-fixture-smoke.cjs scripts/workspace-ui-smoke.cjs scripts/runtime-env-smoke.cjs scripts/session-actions-smoke.cjs scripts/session-health-smoke.cjs scripts/terminal-smoke.cjs tests/clean-install/verify.cjs /opt/spi-test/
CMD ["node", "/opt/spi-test/verify.cjs"]
