# Things Loop Object Map and process/effect sandbox

**Status:** exploratory, non-executing UI prototype. [Work #5](https://github.com/toasterman234/jeview/issues/5) is stacked on read-only bridge [PR #4](https://github.com/toasterman234/jeview/pull/4), which stacks on the native-canvas [PR #2](https://github.com/toasterman234/jeview/pull/2). This is not a merge, Mac deployment, accepted runtime policy, or official Things Loop surface.

## Purpose

The requested primary UI is **the objects**, not a five-box decision diagram. All source-backed records (not only the first 14 neighbors) live in an Object Map grouped by type, with typed labels and properties. Processes and their dependencies can be inspected. A local sandbox lets the user compose Event → Guard → Effect steps and see their hypothetical state changes and replay; it is **not the Things Loop runtime**.

The actual Mac-local React project `things-workflow-canvas` has *not* been modified by this branch. The user's recent agent transcript reported changes there, but did not prove a mounted new UI or a served/deployed build. The only tested implementation here is the **existing Jeview canvas** with no graph-framework replacement.

## Source model / provenance

- Opt-in exporter: `scripts/export-things-loop.py` reads explicit Note/Case/Phase/NoteLink YAML; it preserves UUID/source identity, `labels`, Intent/Topic/State/Kind/Stance axes, phase order, stage and directed link rationales. **Never exports note bodies**, access tokens or private runtime sessions.
- If present, the private Things Loop `system-graph/graph.json` is read as **historical system topology**: actor, system, store, model, check, code, process, output and gap nodes, and their observed/declared/inferred/missing/conflicting edges. That file is an older deterministic snapshot, **not live process telemetry**. It is optional; the exporter still works if absent.
- Every export includes a source revision SHA-256 derived from actual input files; the viewer reports the export timestamp, source authority `unverified` and age. The topology part is always marked `historical` even if the JSON was just exported from the Mac.
- A bounded, validated `GET /_/api/sources/things-loop` exposes only the **explicitly configured local private file** on Jeview's loopback server. The browser cannot choose a filesystem path or write to Things Loop. The public Jeview Git tree contains **code and synthetic test fixtures only**, not private Things Loop data.
- The historical system graph doesn't include first-class agent/capability objects and the current LinkML schema models only Note, CompositeCase, Phase and NoteLink. Therefore an Agent, Policy, Skill, Resource, Effect or Event must **not** be fabricated as an observed source object. Those require source adapters and verified authority later.

## Native UI and how to use it

The top navigation prioritizes **Objects · Processes · Simulate · Observe**, with the original **Jev Decisions** and deliberately synthetic Context/Harness examples still available. When a real local snapshot is configured, **Objects** opens automatically; otherwise Jeview retains its original Decisions default and honestly reports disconnected source status when Objects is opened.

In **Objects**, every record is drawn in a category constellation rather than truncating to 14. Type hubs show counts and can be clicked to filter; the left sidebar offers a type/label/text search, inventory and focus/expand. Zooming into a cluster makes individual node labels legible; their text shows type, stage/status and first labels. Clicking a source-backed object opens the existing inspector with the precise source file, original IDs, evidence, full typed label axes and recorded inbound/outbound relationships. Double click resets auto-fit. At a very wide overview the objects appear as dots around readable type hubs to avoid an unusable wall of overlapping text.

In **Processes**, the historical process entities from `system-graph/graph.json` are browsable and focusable. They **describe** observed/declared flows; they have not become compiled process definitions or executable process policy.

In **Simulate**, a process draft contains a typed target object type, a trigger event and **1–8 guard/effect steps**. The browser offers `always`, `stage_is`, `status_is`, `has_intent` guards and `highlight`, `set_stage`, `set_status`, `emit` effects. The engine enforces the modeled CaseStage transition adjacency, denies unsupported stage transitions and invalid types, and never dispatches an agent. Clicking Start, Step, Play, Replay or Reset advances/clears the **isolated simulated overlay**. Active targets pulse on the native canvas and the sidebar records the event, guard result, hypothetical effect and outcome. Definitions saved with `Save local draft` remain in the current browser's `localStorage` only, are not canonical system records and are not automatically approved.

In **Observe**, the historical graph's reported `observed` relations are listed as old source assertions and the UI explicitly says **NOT LIVE**. There is no live event journal subscription or proof of a currently running workflow.

## Current operational gates

1. **Exact-head tests:** `npm run typecheck`, `npm run check:pages`, `npm test`, Chrome native Canvas interaction smoke, Python exporter privacy/lineage tests. Browser test covers object inventory and source focus, Processes/Observe, a two-step simulation affecting a Case's overlay, Reset clearing it, original Decisions view and a mobile viewport.
2. **Real data:** the authoritative Mac `~/things-ontology-loop/` was not read in this work due the governed Mac runner being unavailable. The static private GitHub repository snapshot is **not** a live source. See [control-plane issue #182](https://github.com/toasterman234/github-workflows-control-plane/issues/182); do not bypass the governed lane.
3. **No promotion:** PR #2, PR #4 and this stacked work remain draft/unmerged. Source correctness, deployed app, live agents, approval gates and effects have not been established. The user still will not see these changes on the existing Mac-served React UI.
4. **Follow-up admitted work:** reconcile the intended single served UI and source of truth; verify the exact Mac file state/build route via the control plane; connect the real event journal/agent capability registry with source citations; promote a process DSL only after authority and simulation acceptance. Execution/dispatch requires a separate gate and independent run/result read-back.

### Scope disclaimer

The sandbox's `set_stage` effect is a **what-if overlay**, not evidence that a Case was dispatched, approved or completed. Likewise `emit` writes a note into simulated trace; it does **not** send any event. A green browser/test run is not a deployment receipt.
