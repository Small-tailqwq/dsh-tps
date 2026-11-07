# dsh-tps

A live TPS (tokens per second) reading at the end of the running status row in DSH Web.

[English](README.en.md) | [简体中文](README.md)

![Demo](assets/dshtpsdemo.gif)

## Installation

For **DSH `0.2.2-alpha.3`**, run:

```sh
dsh plugin --profile web add 'github:Small-tailqwq/dsh-tps'
```

Restart your running DSH instance:

```sh
dsh web
```

Reopen the page and start a task. Once streamed output arrives, the badge appears:

```text
Deep diving for 24s ···  24.37
```

GitHub installs build the plugin automatically. If pnpm blocks build scripts, configure the Web profile's `allowBuilds` as prompted and retry.

### Install a local package

For a prebuilt `.tgz`, substitute its actual path:

```sh
dsh plugin --profile web add './dsh-tps.tgz'
```

Prebuilt packages contain ready-to-load runtime code and require no Harness checkout or local compilation.

## Features

- **Live rate:** a rolling 5-second window estimates streamed output from the UTF-8 bytes of text and reasoning blocks.
- **Digit reels:** every digit is a 0–9 reel that rolls up or down with the value and wraps through the reel (9→0, 0→9) instead of jumping.
- **Natural visibility:** appears with the running status row and disappears with it when the turn ends; returns to `00.00` after roughly 1.5 seconds without output.
- **Hover fade:** fades after a 2-second hover, becomes click-through, and returns 3 seconds after the pointer moves away.
- **Language-independent mounting:** uses semantic DOM structure, without matching translated labels or CSS hashes.
- **Front-end only:** reads DSH session snapshots without extra network requests. The native stats line continues to provide averages, first-token latency, and total usage.

## In the plugin UI

After installation, Plugin Manager and Settings show the title “TPS live rate”, the description and the icon; the detail page includes a reading preview. Chinese UI shows “TPS 实时速率”.

## Installed but not visible

1. Confirm the task is running. The status row only exists during a run, and the badge appears with it; before the first streamed output it reads `00.00`.
2. Confirm TPS is enabled. If you use `dshmarket`, enable it there too: the market restores its saved disable list, which profile configuration alone does not override.
3. Restart DSH after installing or replacing the package, then reopen the page.
4. Check the host version and whether the active skin preserves the chat status row. Other versions or altered layouts may require adaptation.

## Token counting

TPS estimates tokens from the UTF-8 bytes of streamed output (roughly one token per 5 bytes). It is not server billing usage or an exact count for any model's tokenizer.

The estimate only reads the streamed text and reasoning blocks and performs no tokenizing work. Hover and restore timings are fixed, with no configuration UI.

## Development

Normal installation requires no Harness source. Development typechecking and tests resolve host interfaces through a sibling checkout:

```text
<parent>/
  deepseek-harness/  # dsh-v0.2.2-alpha.3
  dsh-tps/
```

Run in this repository:

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

`pnpm run prepare` is the self-contained Git-install build. It does not read the sibling checkout and should produce the same runtime code as the full build. `pnpm run dev` watches source changes.

The plugin obtains session hooks through `conversation.composer.dock`, then uses a React Portal to append to the icon and elapsed-time line inside the running status row `[data-chat-running]` within the current `[data-conversation-scroll]`. It manages only its own container and leaves host nodes in place.

## License

BSD-3-Clause. Originally distributed as `packages/client/ui-tps` in the early Harness monorepo.
