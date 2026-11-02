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
`media/gem-dark.svg` and `media/gem-light.svg` are static renders of the app's logo mark
(`CairngormMark`, full gem in its rest pose) with the obsidian and paper colors, chosen by
GitHub's color scheme.

Keep only curated documentation images here; test outputs and throwaway previews stay in
ignored `logs/` and can be removed after review.

## GitHub presentation

The README supplies the repository's landing page. GitHub's About panel and social preview
are separate repository settings; changing these files does not update those settings.
Suggested metadata:

| Setting     | Value                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| Description | A desktop workspace for coding agents, terminals, files and Git.                 |
| Website     | `https://cairngorm.dev`                                                          |
| Topics      | `ai-agents`, `terminal`, `developer-tools`, `tauri`, `mcp`, `rust`, `typescript` |

`media/social-preview.png` is a 1280 × 640 sharing image composed from the existing gem
and workspace demo. A repository administrator can upload it under **Settings → General →
Social preview**. Edit the description, website and topics using the gear beside **About**
on the repository's Code page. Refresh the social preview when the workspace demo changes.
