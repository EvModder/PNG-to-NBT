Fixture tests live in [`cases/`](REPO_ROOT/website/tests/cases).

Each test is a single `*.json` file. `input` and `output` paths are resolved relative to [`cases/`](REPO_ROOT/website/tests/cases), so multiple tests can reuse the same image and output artifacts.

Run:
```bash
bun run test:fixtures
bun run test:fixtures --update
bun run test:fixtures Staircase-Northline
```
