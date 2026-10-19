Fixture tests live in [`cases/`](cases).

Each test is a single `*.json` file. `input` and `output` paths are resolved relative to [`cases/`](cases), so multiple tests can reuse the same image and output artifacts.

Routine offline checks:
```bash
bun run test
```

Runs test typechecking, file headers, support rules, versions, presets, pixel scaling
and offline catalog audits. No geometry/export matrices, real workers, browsers,
downloads or Java. Builds, previews and deployment do not trigger these suites automatically.

`test:headers` checks each source file's purpose, Public API and Callers lists against
its exports and importers. After moving code, `bun run tests/fileHeaders.mts --fix`
rewrites the lists; it never invents purpose text.

Use the smallest relevant command while editing. Full engine/export coverage is
explicit, for broad changes or publication review, not every edit:
```bash
bun run test:all
```

Fixture exports (filter by case name to avoid unrelated maps):
```bash
bun run test:fixtures
bun run test:fixtures --update
bun run test:fixtures img4-northline
```

Hosted API checks:
```bash
bun run test:api
bun run build
bun run test:api-browser
```

The browser suite uses Playwright Chromium and WebKit on two temporary local origins,
including the `/PNG-to-NBT/` deployment prefix. It checks transport lifecycle, delivery
isolation, and byte-equivalent exports from the API and the site's actual UI.

The API suite also checks the help table's options, defaults, enums and numeric bounds
against actual generation/validation, including mode-dependent adjustments.
When changing generation behavior, update the API adapter, standalone contract, help
table and parity tests in the same commit as the feature. Prefer shared engine policy
over duplicated rules. UI-only changes need no API option. Do not silently widen the
single-128x128-tile input contract.

Targeted support eligibility and placement checks:
```bash
bun run test:rules
bun run test:invariants --placement
bun run test:invariants --support
```

`test:rules` checks block/substrate rules without generating shapes; `--placement`
checks hazard detection using small synthetic shapes. Use
`test:invariants --support`, `--environment` or `--slope` for the affected generator
path; omit flags only when intending to run the whole invariant suite.

`test:versions` includes the offline support audit. Rule/catalog/version changes
invalidate its review; comments and formatting do not. Game probes remain explicit:
```bash
bun run audit:block-support --server <vanilla-server.jar>
bun run build:block-passability
bun run audit:block-support --input <probe.json> --update-review
```

Use the target's official unobfuscated server JAR and compatible JDK (currently
Java 25). The probe checks every vanilla block/state, binds block/fluid tags, and
tests all configured substrates plus representative support shapes. Reports and
binaries stay in ignored `work_files/reports/block-support/`, never browser bundles.
It bootstraps registries without starting a server or uploading data.

For each version/snapshot, review new implementations, failed pairs and shape
differences; fix rules or document intentional limits in
`scripts/block-support-review.json`. Adding an omitted block to the catalog must
implement its rule. Only then use `--update-review`; unclassified cases still fail.
Use `--compare <previous-probe.json>` for block/tag diffs. Rule-only edits can reuse
cached `--input` data; game/probe changes require a fresh Java run.

Passability (no collision box) is generated, not hand-kept: `build:block-passability`
rewrites `src/data/blockPassability.ts` from the cached probe (or `--input <probe.json>`)
and prints what changed since the previous version. The audit then requires every
block state to match. The data describes the target version; if a block's passability
changes between supported versions, add a version rule in `src/lib/blockSupport.ts`.

The probe samples below-support survival at light 15, not every world/tick state.
Side/ceiling attachments, compound blocks and exotic custom shapes retain documented
limits, not blanket survival guarantees. Older obfuscated JARs need a mapped probe;
historical targets intentionally use modern substrate rules. Modded blocks are out of scope.

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
