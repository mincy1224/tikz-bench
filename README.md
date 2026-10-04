# TikZ Bench

[中文说明](README.zh-CN.md)

A local, self-hosted visual workspace for TikZ. Edit supported diagrams on a canvas or in the source editor, with TikZ source as the saved document.

TikZ Bench is an independently maintained derivative of [TikZ Editor](https://github.com/DominikPeters/tikz-editor) by **Dominik Peters**. It retains the original parsing and rendering foundations, with additional local project management, formatting controls and system installation support.

## Features

- Shapes, paths, curves, text, groups and anchor connections.
- Multipart rectangles with horizontal or vertical sections, individual content and fills.
- Font size, colors, line width and independently sized arrowheads; previews, undo/redo and multi-selection editing.
- Local projects with automatic saving; TeX, SVG, PNG and PDF export.
- Same-origin MathJax formulas and local LaTeX / Chinese XeLaTeX compilation.
- Example matrices, flowcharts, plots and circuits. Advanced Forest, PGFPlots and Circuitikz code uses local TeX compilation; direct canvas editing depends on supported syntax.

## Install from source

**Target:** Ubuntu 24.04 with systemd, including WSL2 with systemd enabled. You need sudo access, network access for npm/apt, and an existing complete TeX Live installation. TeX Live 2026 is the intended target; the installer does not install or replace TeX.

After cloning **this repository**, run from its root:

```bash
bash install.sh
```

No separate build or packaging step is needed. The script installs missing non-TeX tools through apt, runs `npm ci`, builds the frontend and server, checks compilation under service isolation, and installs the `tikz-bench` command and systemd service. Node.js 18.19+ and npm are needed for building (Node.js 22+ recommended); an existing older Node.js must be updated first.

TeX must provide `latex`, `xelatex`, `dvisvgm`, `dvipdfmx` and `kpsewhich`, with TikZ, standalone, Forest, PGFPlots, Circuitikz, ctex, fontspec and Fandol fonts. Missing Chinese system fonts are installed through apt. To specify the existing TeX directory:

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

A fresh installation starts automatically. Open **http://localhost:5173**. Existing installations retain configuration, project data and their previous service state. **Do not delete the old installation first.** Failed installation checks restore the previous program and configuration. Real Ubuntu/systemd/TeX Live 2026 acceptance is still pending.

## Use and upgrade

Create a project, enter TikZ code or add shapes from the toolbar, then select objects to edit their formatting. Projects save automatically. Use **LaTeX compilation preview** for advanced code.

```bash
tikz-bench start
tikz-bench status
tikz-bench stop
tikz-bench restart
tikz-bench logs
tikz-bench version
tikz-bench backup ./projects-backup.sqlite
tikz-bench upgrade /path/to/tikz-bench-source
tikz-bench rollback
```

To upgrade, run `git pull --ff-only` in your source checkout, then `bash install.sh` again. Alternatively, `tikz-bench upgrade /path/to/tikz-bench-source` builds and installs that checkout. `rollback` switches programs without replacing the database; backup restores the original running/stopped state.

Programs: `/opt/tikz-bench/releases/`. Configuration: `/etc/default/tikz-bench`. Default database: `/var/lib/tikz-bench/tikz-bench.sqlite`. The service listens on `127.0.0.1:5173` by default.

## Development

With Node.js 22+ and npm, run `npm ci` then `npm run dev:full` from the repository root. For a production build without installing a service, run `npm run build` followed by `npm run build:full`. System installation requires Linux; development builds can also run on Windows.

See [server configuration](apps/server/README.md) and [source installation details](design/build-and-upgrade.md).

## License

MIT; the original copyright and license notice are preserved in [LICENSE](LICENSE). See [NOTICE.md](NOTICE.md) for attribution and modification details. TikZ Bench is maintained independently; these modifications do not imply endorsement by the original author. Bundled third-party components retain their own licenses.
