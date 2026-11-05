// Explicitly synthetic, read-only examples for exploring typed objects on Jeview's existing canvas.
// Never dispatch actions or claim to reflect a connected repository, document, or agent.
(() => {
  const core = Object.freeze({ id: "jev", type: "decision", label: "Jev", detail: "The decision model; no action is executed by this example.", status: "sample", x: 0, y: 0 });
  const views = {
    context: {
      nodes: [
        { id: "case", type: "event", label: "New case", detail: "An illustrative incoming Things Loop case.", x: -215, y: -125 },
        { id: "repo", type: "repository", label: "Repository", detail: "Source metadata, changes and relevant code excerpts could inform a judgment; no repository is connected.", x: -220, y: -20 },
        { id: "document", type: "document", label: "Document", detail: "Versioned notes or documentation excerpts could be retrieved and cited; no document is connected.", x: -220, y: 85 },
        { id: "snapshot", type: "context", label: "Context snapshot", detail: "A future bounded, versioned snapshot of exactly what Jev saw. This one contains no real data.", x: 0, y: 145 },
        { id: "option", type: "capability", label: "Eligible options", detail: "Future deterministic filters produce only allowed candidates for a Jev choice.", x: 225, y: -80 },
        { id: "answer", type: "outcome", label: "Proposed route", detail: "An illustrative decision result, not an observed answer or authorized action.", x: 225, y: 70 },
      ],
      edges: [
        { from: "case", to: "jev", type: "triggers" }, { from: "repo", to: "snapshot", type: "informs" },
        { from: "document", to: "snapshot", type: "informs" }, { from: "snapshot", to: "jev", type: "uses_context" },
        { from: "option", to: "jev", type: "candidate_for" }, { from: "jev", to: "answer", type: "proposes" },
      ],
    },
    harness: {
      nodes: [
        { id: "policy", type: "policy", label: "Policy", detail: "Deterministic eligibility and permission checks occur before and after a judgment.", x: -225, y: -120 },
        { id: "workflow", type: "workflow", label: "Workflow", detail: "A composable sequence of event-driven steps. No workflow is running.", x: -225, y: -10 },
        { id: "machine", type: "state_machine", label: "State machine", detail: "Lifecycle states govern permissible transitions; this is not attached to a runtime.", x: -225, y: 110 },
        { id: "agent", type: "agent", label: "Agent", detail: "A potential executor. Neither an agent connection nor dispatch authorization exists here.", x: 225, y: -120 },
        { id: "skill", type: "skill", label: "Skill", detail: "Reusable agent behavior with declared inputs and prerequisites.", x: 225, y: -10 },
        { id: "tool", type: "tool", label: "Tool", detail: "An operation an agent could use only after scope and policy checks.", x: 225, y: 110 },
        { id: "capability", type: "capability", label: "Capability", detail: "A typed manifest listing what is available, eligible, or forbidden.", x: 0, y: 160 },
      ],
      edges: [
        { from: "policy", to: "jev", type: "constrains" }, { from: "machine", to: "workflow", type: "controls" },
        { from: "workflow", to: "jev", type: "offers_route" }, { from: "capability", to: "jev", type: "candidate_for" },
        { from: "jev", to: "agent", type: "could_select" }, { from: "agent", to: "skill", type: "has" },
        { from: "skill", to: "tool", type: "uses" }, { from: "capability", to: "agent", type: "describes" },
      ],
    },
  };
  for (const view of Object.values(views)) {
    view.nodes = Object.freeze(view.nodes.map((node) => Object.freeze({ ...node, status: "sample", w: 146, h: 55 })));
    view.edges = Object.freeze(view.edges.map((edge) => Object.freeze({ ...edge, status: "sample" })));
    Object.freeze(view);
  }
  Object.freeze(views);
  const viewFor = (mode) => views[mode] ?? null;
  const nodes = (mode) => viewFor(mode)?.nodes ?? [];
  const edges = (mode) => viewFor(mode)?.edges ?? [];
  const nodeById = (mode, id) => id === "jev" ? core : nodes(mode).find((n) => n.id === id);
  const relations = (mode, id) => edges(mode).filter((edge) => edge.from === id || edge.to === id);
  const bounds = (mode, center = { x: 0, y: 0 }) => {
    const list = nodes(mode);
    return {
      l: center.x + Math.min(-30, ...list.map((n) => n.x - n.w / 2)) - 24,
      r: center.x + Math.max(30, ...list.map((n) => n.x + n.w / 2)) + 24,
      t: center.y + Math.min(-28, ...list.map((n) => n.y - n.h / 2)) - 58,
      b: center.y + Math.max(30, ...list.map((n) => n.y + n.h / 2)) + 24,
    };
  };
  const hit = (mode, x, y) => {
    for (const node of [...nodes(mode)].reverse()) if (Math.abs(x - node.x) <= node.w / 2 && Math.abs(y - node.y) <= node.h / 2) return node;
    return Math.hypot(x, y) < 25 ? core : null;
  };
  const draw = (ctx, center, colors, mode) => {
    if (!viewFor(mode)) return;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = colors.strong;
    ctx.setLineDash([3, 5]);
    ctx.globalAlpha = 0.8;
    for (const edge of edges(mode)) {
      const from = nodeById(mode, edge.from), to = nodeById(mode, edge.to);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const ink = colors.ink, accent = colors.accent;
    for (const node of nodes(mode)) {
      ctx.beginPath(); ctx.roundRect(node.x - node.w / 2, node.y - node.h / 2, node.w, node.h, 11);
      ctx.fillStyle = colors.paper; ctx.fill(); ctx.strokeStyle = node.type === "repository" || node.type === "document" || node.type === "context" ? (colors.families?.[0]?.[0] ?? ink) : node.type === "agent" || node.type === "skill" || node.type === "tool" ? (colors.families?.[2]?.[0] ?? ink) : colors.strong;
      ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = colors.muted; ctx.font = `10px ${colors.body}`; ctx.fillText(node.type.replaceAll("_", " ").toUpperCase() + " · SAMPLE", node.x, node.y - 10);
      ctx.fillStyle = ink; ctx.font = `600 13px ${colors.body}`; ctx.fillText(node.label, node.x, node.y + 10);
    }
    ctx.fillStyle = colors.paper; ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `italic 15px ${colors.display}`; ctx.fillText("Jev", 0, 18);
    ctx.fillStyle = colors.muted; ctx.font = `600 11px ${colors.body}`;
    ctx.fillText("SAMPLE GRAPH · NOT CONNECTED · NO ACTIONS", 0, -202);
    ctx.restore();
  };
  globalThis.JeviewSampleGraph = Object.freeze({ nodes, edges, nodeById, relations, bounds, hit, draw });
})();
