# AGENTS.md

dsh-tps is the standalone distribution of the TPS badge plugin for DSH Web,
developed against a sibling `deepseek-harness` checkout (see the README's
Development section for the sibling-layout contract).

- **Type resolution goes through the sibling checkout.** `tsconfig.json`
  extends `../deepseek-harness/tsconfig.base.json` and lists project
  references there; `tsc -b` and vitest (via `vite-tsconfig-paths`) resolve
  `@deepseek-ai/dsh-*` through that base's `paths` to the sibling's sources.
  Typecheck, build, and tests require the sibling checkout at
  `../deepseek-harness`.
- **Consumer builds never touch the sibling.** The `prepare` script runs
  `tsdown` with the shared `tsdown.config.ts` — a type-unchecked src→lib
  transpile under the self-contained `tsconfig.prepare.json` — so a machine
  without the sibling checkout can still install and build this package
  (pnpm ≥ 10 needs the `allowBuilds` key in `pnpm-workspace.yaml`).
- Run `pnpm run typecheck && pnpm test && pnpm run build` before pushing;
  `pnpm run build` and `pnpm run prepare` must produce equivalent `lib/`
  artifacts for the same src (module-for-module, deterministic class maps).
