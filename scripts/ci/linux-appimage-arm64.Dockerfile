# Packs the arm64 AppImage from the cross-built .deb (scripts/build-appimage.sh). AppImage
# tools must run on the target architecture, so this runs under arm64 emulation; it only
# copies and patches files, the slow compile already happened in the cross build.
FROM arm64v8/ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
# ldconfig (libc-bin's trigger) sometimes crashes under qemu; configuring again succeeds,
# so each install gets a few attempts.
RUN apt-get update \
    && for attempt in 1 2 3; do \
         apt-get install -y --no-install-recommends \
           ca-certificates curl file pkg-config dpkg-dev \
           libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev \
         && break; \
         dpkg --configure -a || true; \
       done \
    && dpkg --configure -a && apt-get install -y --no-install-recommends dpkg-dev \
    && rm -rf /var/lib/apt/lists/*
