# Cairngorm documentation

## Using Cairngorm

- [Get started](development.md#toolchain) — run the development build from source.
- [Settings](settings-file.md) — preferences and the user configuration file.
- [The `cairngorm` command](command-line.md) — open projects, files, terminals and agents from any terminal.
- [Document providers](document-providers.md) — open documents and add file-format support.
- [Test browser](test-browser.md) — follow browser tests and open a separate preview.
- [Security](security.md) — permissions, credentials, data retention and platform limits.

## Building and contributing

- [Development and debugging](development.md)
- [Architecture](architecture.md) and [coding conventions](coding-conventions.md)
- [Tests](../tests/README.md) and [build scripts](../scripts/README.md)
- [macOS builds](macos-build.md)
- [Contribution guidelines](development.md#contributing) and [licensing](development.md#licensing)

## README images

`media/workspace.png` is the workspace demo image from the website (cairngorm.dev,
`assets/demo/workspace.png` in the website repository): Claude Code, Codex CLI and Oh My Pi
beside the editor with local sample replies. To refresh it, copy the website's current image.
The two button SVGs in `media/` are local navigation-button images. `media/gem-dark.svg` and
`media/gem-light.svg` are static renders of the app's logo mark (`CairngormMark`, full gem in
its rest pose) with the obsidian and paper colors, chosen by GitHub's color scheme.

Keep only curated documentation images here; test outputs and throwaway previews stay in
ignored `logs/` and can be removed after review.
