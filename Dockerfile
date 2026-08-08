FROM ubuntu:24.04

ARG NODE_VERSION=24.18.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils \
    && curl --fail --silent --show-error --location "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && tar --extract --xz --file /tmp/node.tar.xz --directory /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && apt-get purge -y curl xz-utils \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin hostmgr

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /var/lib/hostmgr \
    && chown -R hostmgr:hostmgr /app /var/lib/hostmgr

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTMGR_MODE=demo \
    HOSTMGR_DATA_PATH=/var/lib/hostmgr/state.json

USER hostmgr
EXPOSE 3000
CMD ["node", "src/server.mjs"]
