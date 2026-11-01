# Build and CI scripts

Run these from the repository root. Generated output belongs in ignored directories;
none of these scripts needs a personal work plan or a helper in `logs/`.

| Script                               | Purpose                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `build-agent.mjs`                    | Installs the sidecar's frozen Bun dependencies and compiles the target binary into `src-tauri/binaries/` |
| `build-cli.mjs`                      | Compiles the `cairngorm` terminal command (Windows, macOS) into `src-tauri/binaries/`                    |
| `build-document-sdk.mjs`             | Regenerates checked-in document SDK and provider JS; `--check` detects stale output                      |
| `ensure-agent-config.mjs`            | Creates missing local agent settings; `--reset` intentionally replaces them                              |
| `gen-brand-icons.mjs`                | Regenerates branding/bundle icons using browser rendering                                                |
| `release-evidence.mjs`               | Generates dependency inventories and checksums from actual build artifacts                               |
| `ci/build-appimage.sh`               | Packages Linux AppImages without passing the Bun sidecar through linuxdeploy                             |
| `ci/smoke-*.sh`                      | Installer/agent launch checks and their shared verdict logic                                             |
| `ci/linux-build.Dockerfile`          | Ubuntu 22.04 build environment for Linux compatibility                                                   |
| `ci/linux-build-arm64.Dockerfile`    | Cross-compiles the Linux ARM64 installers on an x86_64 host with Ubuntu 22.04's arm64 libraries          |
| `ci/linux-appimage-arm64.Dockerfile` | Packs the ARM64 AppImage under arm64 emulation                                                           |
| `ci/setup-wsl.sh`                    | Opt-in WSL toolchain provisioning; installs packages and changes Docker group/service setup              |
| `ci/local-linux.sh`                  | Runs checks and packaging in a dedicated WSL checkout, then container smoke tests                        |

## CI entry points

- `.github/workflows/ci.yml`: frontend, sidecar and Rust checks; Linux installers and
  distro smoke tests on main pushes, PRs or manual runs. Its legacy Playwright job is
  explicitly non-blocking; a successful workflow does not imply that suite passed.
- `.github/workflows/security.yml`: production npm dependency audits and Cargo advisories.
- `.github/workflows/build.yml`: manual target builds and version-tag builds. Tagged
  Windows/macOS builds require signing credentials; output includes inventories/checksums,
  not provenance attestations.
- `codemagic.yaml`: macOS builds and smoke tests through a configured external service.
  A fork does not acquire the original repository's webhook, secrets or signing setup.

## Local Linux CI caution

`ci/local-linux.sh` resets and cleans its dedicated `$HOME/cairngorm-ci` checkout, keeping
selected build caches, then copies this working tree into it. Do not use that directory
for unrelated work. The script also manages `$HOME/.cache/cairngorm-ci/bin` and a separate
Docker configuration. Review it before running; setup and container downloads need network
access and consume disk space. Artifacts go to `logs/ci-linux/`.

Normal frontend work does not require WSL provisioning, Docker packaging, signing keys or
running the entire release pipeline. Use the checks for the feature you changed.
