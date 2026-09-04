Fixture tests live in [`cases/`](cases).

Each test is a single `*.json` file. `input` and `output` paths are resolved relative to [`cases/`](cases), so multiple tests can reuse the same image and output artifacts.

Run:
```bash
bun run test:fixtures
bun run test:fixtures --update
bun run test:fixtures img4-northline
```
