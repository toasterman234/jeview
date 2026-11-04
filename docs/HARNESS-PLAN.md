# Jeview composable harness — phased exploration and build plan

Status: **Exploration; first slice is fixture-only and read-only.** Owner of implementation decisions: repository maintainer. Created 2026-11-04. Tracks [issue #1](https://github.com/toasterman234/jeview/issues/1).

## Goal and constraints
Keep **Jeview's existing HTML canvas and JavaScript renderer**. Do **not** add AntV, a graph framework, or runtime dependencies. Make Jev decisions visible together with the resources they considered, capability and policy candidates, and later evidence of the actions actually taken. Retain transparent `/v1/systemone` semantics, byte-for-byte upstream body, loopback-only boundary, existing trace UX, and backward-compatible viewer/server contracts.

Do not confuse diagrams with proven runtime behavior: simulated nodes are marked, no fixture path may execute tools, and the Jev answer never grants authority to perform an action. No self-modifying agent or active dispatch is authorized here.

## History and authority
- Source and current constraints: `README.md`, `AGENTS.md`, `docs/agent-context.md`, `src/jeview.ts`, `ui/app.js`.
- Existing Jev Workbench versions judgment functions, and Jev Supervisor is currently observe-only; see issue #1 for references.
- **Supersession:** the XState Supervisor visual/execution exploration ([issue #12](https://github.com/toasterman234/jev-supervisor/issues/12), [PR #13](https://github.com/toasterman234/jev-supervisor/pull/13)) was explicitly parked and closed without merge on 2026-09-29. Do not adopt its enforcement or reactivate it implicitly.
- The current request authorizes beginning a *bounded Jeview design/prototype*, **not production agent execution, policy changes or merge**.

## Object and edge contract (proposed, not authority)
Typed nodes: `decision`, `event`, `context`, `repository`, `document`, `agent`, `skill`, `tool`, `capability`, `workflow`, `policy`, `state_machine`, `run`, `outcome`, `evidence`.
Edges: `informs`, `contains`, `offers`, `requires`, `eligible_for`, `selected`, `triggered`, `executed_by`, `produced`, `feeds_back`.
Every observed edge must refer to a source event/call, revision and identity; fixtures are explicitly synthetic. A document can inform a judgment, but it is not a tool. An agent is a possible executor, but not an authorized one merely because Jev selected it.

## Delivery sequence and acceptance gates

### Phase A — fixture-based canvas slices (IN PROGRESS; exploration)
- Add minimal, explicitly **sample** Context and Harness layers, with toggle control in the existing Jeview page.
- Draw nodes and edges through Jeview's **existing CanvasRenderingContext2D**, not a replacement library.
- Start from a typed *static fixture* with repository, document, agent, skill, policy, capability and links. No scan, network API or automatic dispatch.
- Click a sample node to open the **existing drawer** with provenance, type, relations, and an explanation that it is sample data.
- Default remains the current decision trace; no changes to Jev request/response or server security.
- Verify `npm run typecheck`, `npm run check:pages`, `npm test`, and a real browser interaction test before promoting from exploration. Existing UI tests are not present, so browser validation is an **explicit open gate**.

### Phase B — read-only observed resource model (NOT STARTED)
- Decide resource ownership and incoming format; model stable identities and change history.
- Attach bounded context snapshots/repository/doc source references to Jev call IDs; preserve exact byte stream sent to TypeSafe. No automatic upload of complete files or session logs.
- Add stale/unavailable/unknown styling and a source/permission drawer.
- Verify a known fixture, the exact input context sent to Jev, and replay fidelity.

### Phase C — decision candidates and harness graph (NOT STARTED)
- Define versioned capability manifests (agent / behavior / skill / tool / workflow) and deterministic eligibility/policy filtering.
- Present eligible, excluded, selected and uncertain Jev choices separately; support independent multi-label decisions.
- Show relevant context and agent capabilities adjacent to Jev's actual choice on the same canvas, with explicit lineage.

### Phase D — non-executing simulation and outcome journal (NOT STARTED)
- Trace Event → Context → Decision → Gate → Proposed Action → Simulated Run → Outcome → Feedback.
- Simulate only in isolated browser/session state; never call a real tool or mutate the runtime.
- Prove replay, denial paths, and the distinction between asserted/observed/simulated states.

### Phase E — real agent dispatch (BLOCKED ON SEPARATE PROMOTION)
- Choose an adapter and authority owner; do not infer agent availability from a registry record.
- Approval-gated, authenticated action dispatch outside Jeview's transparent proxy, with allowlisted actions, scope checks, idempotency and audit.
- Verify request acceptance, observed run state, actual result evidence, and dependent state updates before marking completed.
- Explicit promotion review required after Phase D; this plan does not approve Phase E.

## Out-of-scope / hard safeguards
- No AntV, graph-framework rewrite, third-party runtime dependency, remote/public binding, repo crawling, auto agent invocation, auto-changing policies, or automatic model evolution.
- No data from fixtures presented as a real resource or actual run.
- Read before write; no merge to main before independent verification and explicit approval.

## Evidence log
- 2026-11-04: inspected `main` head `52d7abf`, `AGENTS.md`, test workflow, server path and renderer. `main` unprotected (not permission to bypass review). Issue #1 remains open.
- 2026-11-04: created `explore/composable-harness-view` from that commit. Slice A is a separate branch, not a deployment.
- Pending: source read-back of each prototype change; unit/type syntax CI; interactive browser proof; maintainer promotion decision.
