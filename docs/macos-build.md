# macOS builds

macOS bundles require a Mac runner with Xcode command-line tools, Node.js 24, Bun 1.3.14
and Rust. The repository has two build entry points: the GitHub `Build` workflow and the
optional Codemagic workflow. They are separate from Linux CI.

## GitHub Actions

1. Open **Actions > Build > Run workflow**.
2. Select the branch and target: `aarch64-apple-darwin` for Apple Silicon or
   `x86_64-apple-darwin` for Intel.
3. Download `cairngorm-<target>` from the completed run's artifacts. It contains the DMG,
   dependency inventories and checksums.

From an authenticated GitHub CLI:

```sh
gh workflow run build.yml --ref <branch> -f target=aarch64-apple-darwin
gh run list --workflow build.yml --branch <branch> --limit 1
gh run watch <run-id> --exit-status
gh run download <run-id> --dir logs/macos-build
```

This workflow runs manually or on `v*` tags, not on ordinary branch pushes. Manual runs
default to one architecture, have a 35-minute job timeout and retain artifacts for one day.
Selecting `all` or pushing a version tag builds all four configured desktop targets.
Other workflows do build installers on ordinary pushes; see [the scripts guide](../scripts/README.md).

## Codemagic

`codemagic.yaml` defines the `macos-installer` workflow. A configured webhook starts it
for pushes to `dev` and version tags. Push builds clone the triggering `dev` revision;
for a manual build, select `dev` as the branch in Codemagic's build dialog. Tag builds
continue to use the tagged revision. The default is Apple Silicon with agent and Rust
checks enabled; Intel can be selected manually. It builds a DMG, runs a native
install/launch smoke check and generates inventories/checksums.

Codemagic requires separate account/project setup; a fork does not inherit that service
configuration. Review the provider's quota and billing controls before enabling automated
builds. Workflow timeouts are not spending limits.

## Signing and release limits

Manual builds without Apple signing secrets are unsigned and not notarized; Gatekeeper
may block them. Tagged macOS builds in GitHub require signing/notarization credentials.
Codemagic signing is optional and uses the variable group described in `codemagic.yaml`.
Never commit certificates, passwords or API keys. See [security](security.md#distribution-and-verification)
for the credential names and release limitations.

The current workflows produce dependency inventories and SHA-256 checksums, not GitHub
build-provenance attestations. A successful bundle or launch check does not establish all
native interactions: validate installation, terminal sessions and macOS permissions on a
real Mac before distributing a release.
