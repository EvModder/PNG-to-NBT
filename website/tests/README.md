Fixture tests live in [`cases/`](cases).

Each test is a single `*.json` file. `input` and `output` paths are resolved relative to [`cases/`](cases), so multiple tests can reuse the same image and output artifacts.

Routine offline checks:
```bash
bun run test
```

Runs test typechecking, support rules, versions, presets, pixel scaling and offline
catalog audits. No geometry/export matrices, real workers, browsers, downloads or Java.
Builds, previews and deployment do not trigger these suites automatically.

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

Targeted support eligibility and placement checks:
```bash
bun run test:rules
```

`test:rules` checks block/substrate rules without generating shapes. Use
`test:invariants --slope` for the affected generator
path; omit flags only when intending to run the whole invariant suite.

`test:versions` includes the offline support audit. Rule/catalog/version changes
invalidate its review; comments and formatting do not. Game probes remain explicit:
```bash
bun run audit:block-support --server <vanilla-server.jar>
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
