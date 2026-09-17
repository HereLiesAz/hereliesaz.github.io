# Archive — historical planning and superseded implementation snapshots

Files under `docs/archive/` are not the current implementation reference. They preserve earlier specifications, experiments, and session snapshots so the design history remains recoverable.

**Archive placement does not mean the underlying capability is unwanted.** Several ideas documented here—shard clouds, DINOv2 matching, anamorphic projection, semantic segmentation—also exist as intentional code paths in `scripts/` and are now indexed by the canonical multi-pipeline integration layer.

For current implementation status, start with [`../PIPELINE.md`](../PIPELINE.md), [`../INTEGRATION.md`](../INTEGRATION.md), and [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## What is here

- **`blueprint.md`, `ProjectOverview.md`, `todo.md`** — early shard-cloud construction notes. Exact proposed stacks or mechanisms may be superseded, but related stroke/shard capabilities remain intentional.
- **`research.md`** — research survey of candidate segmentation, depth, matching, rendering, and UI techniques. It is background material, not an assertion that every named technique is currently active.
- **`superpowers/`** — dated design specs and implementation plans for the unified shard field and its preprocessor/viewer. The shipped gallery currently renders the paper-theater representation, while the unified-shard preprocessor and related code remain intentional parallel capabilities.
- **`HANDOFF-2026-07-03.md`** — a historical session snapshot superseded by `../HANDOFF.md`.

## Current rule

Use current code and current docs to determine status. An implementation with no current runtime consumer is **unwired**, not automatically abandoned, dead, or orphaned. Broken or incomplete paths should be repaired or completed unless Az explicitly decides the capability is no longer wanted.

Current representation/pipeline mapping lives in `../PIPELINE.md`; canonical cross-pipeline discovery lives in `../INTEGRATION.md`.
