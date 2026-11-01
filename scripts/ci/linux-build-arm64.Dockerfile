# Linux ARM64 (aarch64) installer build environment: cross-compiles on an x86_64 host
# against Ubuntu 22.04's arm64 libraries, so the binaries run where the x86_64 ones do
# (glibc 2.35: Ubuntu 22.04+, Debian 12, Fedora, Raspberry Pi OS 64-bit bookworm).
FROM ubuntu:22.04

ARG NODE_VERSION=24.22.1
ARG BUN_VERSION=1.3.14
ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/node/bin:/usr/local/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# amd64 packages come from the main archive, arm64 ones from ports.ubuntu.com.
RUN sed -i 's/^deb /deb [arch=amd64] /' /etc/apt/sources.list \
    && for suite in jammy jammy-updates jammy-security; do \
         echo "deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports $suite main restricted universe multiverse" \
           >>/etc/apt/sources.list.d/arm64.list; \
       done \
    && dpkg --add-architecture arm64 \
    && apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git file xz-utils unzip pkg-config \
      gcc-aarch64-linux-gnu g++-aarch64-linux-gnu libc6-dev-arm64-cross \
      libwebkit2gtk-4.1-dev:arm64 libayatana-appindicator3-dev:arm64 librsvg2-dev:arm64 \
      libxdo-dev:arm64 libssl-dev:arm64 \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | CARGO_HOME=/usr/local/cargo sh -s -- -y --profile minimal --default-toolchain stable \
         --target aarch64-unknown-linux-gnu \
    && chmod -R a+rwX /usr/local/rustup /usr/local/cargo

RUN mkdir -p /usr/local/node \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /usr/local/node --strip-components=1

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local/bun bash -s "bun-v${BUN_VERSION}"

# Link and find libraries for the arm64 target (pkg-config reads the arm64 .pc files).
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
    AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
    PKG_CONFIG_ALLOW_CROSS=1 \
    PKG_CONFIG_SYSROOT_DIR=/ \
    PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
