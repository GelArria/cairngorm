# Coding conventions

Use these conventions throughout first-party source. Keep TypeScript idiomatic
for Preact and the Bun sidecar, and Rust idiomatic for native code.

## Readability

- Use complete blocks for control flow and put separate actions on separate lines.
- Name functions after the behavior they perform. Name interfaces after the
  settings or data they describe, such as `OpenTabOptions` or `FileActionOptions`.
- Use named options for groups of related optional settings. Terminal launches
  should state their shell, environment, session and directory explicitly.
- Keep public interfaces small. Preserve useful type inference for hooks and
  internal calculations; annotate contracts when the return shape matters.
- Explain invariants, fallback behavior and performance constraints in comments.
  Keep work history and reviewer references out of implementation comments.

## Responsibilities

- Keep UI rendering separate from transport, state transitions and pure calculations.
- Preact hooks own subscriptions and effects. Pure helpers do not acquire subscriptions.
- The agent runtime owns run settlement and ordered event delivery. The turn loop
  owns turn progression; tool preparation, execution and results stay distinct.
- Native PTY code separates command handlers, session ownership, reading and JSONL
  decoding. Keep the existing lock scope, output bounds and event order.
- Aim for roughly 200 lines per file. Split at a coherent responsibility; a
  stateful facade or protocol implementation may be larger when splitting it
  would expose its internals or require pass-through modules.

## Errors and compatibility

Use `common/errors.ts` to convert unknown frontend rejections into messages.
The standalone sidecar uses its own `ai/utils/error-message.ts`. Rust operations
retain their existing `Result` contracts. Report failures at the UI or operation
that owns them; optional cleanup and best-effort fallbacks should explain why
failure is acceptable. Avoid introducing a framework-wide error abstraction.

Preserve public entry points, lazy imports, singleton ownership, IPC command names
and mount lifetimes. Refactors must keep stream ordering, cancellation and saved
workspace behavior intact.

## Formatting

`npm run format` formats first-party TypeScript, JavaScript, CSS, build configuration and tests;
`npm run format:check` checks them. `npm run format:rust` formats Rust through the
Cargo crate. The root Prettier configuration also applies to the standalone sidecar.
