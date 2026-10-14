# The sandbox every web.bluethenics.com user gets: ADCode's main process (adcode-host), headless,
# with the tools Vibe's agent uses - Node, git, Chromium for looking at pages.
#
# Built by Wrangler from apps/cloud (see wrangler.jsonc "images"). `npm run cloud:build` puts the
# adcode-host bundle in ./host first. Cloudflare's managed image already carries Node 24.
FROM cloudflare/debian-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git tar gzip ca-certificates curl procps \
      chromium fonts-liberation \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# A person's whole cloud workspace is this one home folder, archived to R2 when it sleeps.
RUN useradd --create-home --home-dir /home/adcode --shell /bin/bash adcode

WORKDIR /opt/adcode
COPY package.json ./
# node-pty is native: built here for Linux and this Node, never copied from a Windows checkout.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY host/ ./host/

ENV NODE_ENV=production \
    ADCODE_HOME=/home/adcode \
    ADCODE_HOST_PORT=7300 \
    ADCODE_HOST_BIND=0.0.0.0 \
    CHROMIUM_PATH=/usr/bin/chromium

USER adcode
WORKDIR /home/adcode
EXPOSE 7300
ENTRYPOINT ["node", "/opt/adcode/host/index.js"]
