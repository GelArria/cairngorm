# Linux installer build environment. Ubuntu 22.04 keeps the glibc requirement
# low, so the binaries also run on Debian 12 and older Ubuntu releases.
FROM ubuntu:22.04

ARG NODE_VERSION=24.22.1
ARG BUN_VERSION=1.3.14
ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/node/bin:/usr/local/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git file xz-utils unzip \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | CARGO_HOME=/usr/local/cargo sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+rwX /usr/local/rustup /usr/local/cargo

RUN mkdir -p /usr/local/node \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /usr/local/node --strip-components=1

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local/bun bash -s "bun-v${BUN_VERSION}"
