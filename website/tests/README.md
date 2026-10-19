Fixture tests live in [`cases/`](cases).

Each test is a single `*.json` file. `input` and `output` paths are resolved relative to [`cases/`](cases), so multiple tests can reuse the same image and output artifacts.

Run:
```bash
bun run test:fixtures
bun run test:fixtures --update
bun run test:fixtures img4-northline
```

Image import checks:
```bash
bun run test:images-browser
```

Checks exact palette PNGs and color-managed photos in Chromium and WebKit using
generated PNGs with gamma/chromaticity metadata.

Worker checks:
```bash
bun run test:workers
bun run test:geometry-browser
```

Checks pool scheduling/failure recovery and compares reused-worker geometry with
fresh calculations in Chromium and WebKit.
