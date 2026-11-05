# Things Loop → Jeview: private, read-only projection

> **Extension note (Work #5):** This document describes the original Phase B slice. The stacked Object Map prototype in [OBJECT-MAP-SIMULATION.md](OBJECT-MAP-SIMULATION.md) retains the same read-only private export boundary but adds the optional historical `system-graph/graph.json` component layer and a browser-only event/guard/effect simulator. The earlier "Case first" and limited-neighborhood UI description is superseded in that stacked prototype, **not** in unmerged parent PR #4. No authoritative Mac source, live event feed or agent dispatcher has been verified.

**Status:** Scoped Phase B prototype in [Jeview Work #3](https://github.com/toasterman234/jeview/issues/3), stacked on [Phase A preview PR #2](https://github.com/toasterman234/jeview/pull/2). No merger, deployment, runtime execution, decision-context injection or Mac live-source verification.

## What is connected

Jeview now has an optional `Things Loop` mode on its existing native canvas. It reads a **user-supplied local JSON export** through Jeview's own loopback-only API, not directly from a remote GitHub repo or Mac. When there is no export, it says **Not connected**; invalid/missing exports say **Unavailable**.

The exporter reads a specific Things Loop source directory, without modifying it:

- `data/dogfood-note.yaml` and `linkml/notes-38-labelled.yaml` — Note UUID, title, status and label axes; **no note body**.
- `data/dogfood-composite.yaml` and `linkml/composites.yaml` — Case stage, destination, next step/owner and ordered Phase nodes.
- `data/dogfood-links.yaml` — preserved directed NoteLinks, typed predicate and bounded rationale.
- Optional `data/highlight-comments.yaml` — only when the chosen local source contains it, with first-class comment NoteLinks.

Accepted predicates: `links_to`, `branches_from`, `prompted_by`, `gates`, `indicts`, `derived_from`. Every node and relationship retains a source path, stable identity and/or index. Broken links are counted but **not turned into invented nodes**.

The exporter uses PyYAML from the Things Loop Python environment as an optional **offline export tool**. **Jeview's running server remains Node 24 standard-library-only.** It never imports Python/YAML packages, scans arbitrary paths, or makes any external source request.

## Explicit local connection

From an authorized local checkout of this branch, export to a **private location outside both Git repositories** using the Python environment that already has PyYAML:

```sh
~/things-ontology-loop/.venv/bin/python scripts/export-things-loop.py \
  --root ~/things-ontology-loop \
  --out ~/.local/share/jeview/things-loop-snapshot.json
```

Then start the Jeview branch with the explicit configured snapshot path:

```sh
node jeview.ts --things-loop-snapshot ~/.local/share/jeview/things-loop-snapshot.json
```

The alternate `JEVIEW_THINGS_LOOP_SNAPSHOT` environment variable is supported. Jeview exposes only `GET /_/api/sources/things-loop` via its existing loopback hostname/origin restrictions. A browser URL query cannot choose a filesystem path; POST/unknown routes cannot write to Things Loop.

**No exporter has been executed on the authoritative Mac in this branch's verification.** The commands above are a documented optional connection, not evidence that a live export exists. The checked-in source and source IDs are *never* copied to Jeview's public repository.

## What the canvas shows

- **Decisions** remains the default and unchanged Jev call trace.
- **Context** and **Harness** remain explicitly synthetic exploration views from Phase A.
- **Things Loop** is a separate native-canvas ego graph centered on one recorded Case (prefers working, then scoped) or a selected Note. A Case shows its source Note and ordered Phases, plus nearby recorded NoteLinks. Nodes/edges are bounded to a compact one/two-hop neighborhood.
- Clicking a node opens the existing Jeview inspector with typed attributes, source file, UUID, export timestamp/revision, inbound/outbound link direction and rationale. Selecting **Focus** re-centers on the chosen Note/Case.
- The center header says **LOCAL SNAPSHOT · NOT LIVE**. Export age and source revision are visible. An exported file is not proof of a refreshed Mac source, valid agent access, or successful execution.

## Safety, governance and evidence

The root of record is the **Mac** under Things Loop's accepted ADR-010. GitHub's copy is a historical mirror; Mac-only annotation/ruling overlays may differ. Every snapshot is labeled `authority: unverified` until source/read-back and provenance are independently checked. The exporter writes atomically with file mode `0600`, refuses export paths inside the Things Loop source or public Jeview repo, and prints only a bounded count/hash receipt. Jeview limits reads to 8 MiB, validates IDs/types/edge endpoints/counts, and strips unsupported properties.

No Things Loop data is automatically sent to Jev; no code calls an agent or sends an action. Adding bounded context to a Jev request, a capability registry, policy gates, and dispatch are separate later phases requiring proper work admission and verification.

**Verification gates:** TypeScript, page JavaScript syntax, Node unit/API tests, Chrome canvas + inspector smoke, and Python exporter tests (synthetic-only). See the draft Work PR/issue for exact run IDs and any failures. A current governed Mac health/record read-back is a separate gate: [Mac control-plane issue #182](https://github.com/toasterman234/github-workflows-control-plane/issues/182) remains open, and a November 4 push-lane run was queued when checked. Do not bypass that control plane to make a live claim.

**Next accepted slice:** obtain a verified Mac export through the governed path; inspect exact source counts, source SHA and export age, and test a real Case/Note/Phase/Link focus/inspector in browser. Keep changes read-only. No live Jev decision routing or agent dispatch without the distinct Phase C/E gates.
