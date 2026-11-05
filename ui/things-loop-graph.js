// A local, source-backed Things Loop projection on Jeview's *existing* canvas.
// No network calls here, no graph framework, and no actions. All content is read from the loopback API.
(() => {
  const MAX_VISIBLE = 14;
  const state = { graph: null, status: "not_configured", message: "No snapshot configured", focusId: null, visible: [], shownEdges: [], ageSeconds: null };
  const words = (value) => String(value ?? "");
  const short = (value, n = 27) => words(value).length > n ? words(value).slice(0, n - 1) + "…" : words(value);
  const allNodes = () => state.graph?.nodes ?? [];
  const allEdges = () => state.graph?.edges ?? [];
  const byId = (id) => allNodes().find((n) => n.id === id);
  const relation = (edge, id) => edge.from === id ? edge.to : edge.to === id ? edge.from : null;
  const allowed = new Set(["based_on", "has_phase", "links_to", "branches_from", "prompted_by", "gates", "indicts", "derived_from"]);

  function focus(id) {
    if (!byId(id)) return false;
    state.focusId = id;
    const root = byId(id);
    const connected = allEdges().filter((edge) => relation(edge, id) !== null && allowed.has(edge.type));
    const direct = connected.map((edge) => ({ node: byId(relation(edge, id)), edge })).filter((x) => x.node);
    // A case's original note has its own recorded links. Show those as a second, explicitly typed hop.
    const note = direct.find((x) => x.edge.type === "based_on")?.node;
    const fromNote = root.type === "case" && note ?
      allEdges().filter((edge) => edge.from === note.id || edge.to === note.id)
        .filter((edge) => !["based_on", "has_phase"].includes(edge.type))
        .map((edge) => ({ node: byId(relation(edge, note.id)), edge })).filter((x) => x.node) : [];
    const selected = [root], keys = new Set([root.id]);
    const links = [];
    for (const { node, edge } of [...direct, ...fromNote]) {
      if (selected.length >= MAX_VISIBLE) break;
      if (!keys.has(node.id)) { selected.push(node); keys.add(node.id); }
      if (keys.has(edge.from) && keys.has(edge.to)) links.push(edge);
    }
    state.visible = selected.map((n) => ({ ...n, w: 150, h: 54, x: 0, y: 0 }));
    state.shownEdges = links;
    const others = state.visible.slice(1), phases = others.filter((n) => n.type === "phase")
      .sort((a, b) => Number(a.properties.phase_order) - Number(b.properties.phase_order));
    const left = others.filter((n) => n.type !== "phase");
    const lay = (list, x, centerY) => {
      const step = 83, start = centerY - ((list.length - 1) * step) / 2;
      list.forEach((n, i) => { n.x = x; n.y = start + step * i; });
    };
    lay(phases, 230, 0);
    lay(left, -230, 0);
    return true;
  }

  function setResult(response) {
    state.status = response?.status ?? "unavailable";
    state.message = response?.message ?? "";
    state.graph = response?.connected && response?.graph?.format === "jeview.things-loop/v1" ? response.graph : null;
    state.ageSeconds = typeof response?.ageSeconds === "number" ? response.ageSeconds : null;
    state.focusId = null; state.visible = []; state.shownEdges = [];
    if (state.graph) {
      const candidates = allNodes().filter((n) => n.type === "case");
      const first = candidates.find((n) => n.properties.stage === "working") ??
        candidates.find((n) => n.properties.stage === "scoped") ?? candidates[0] ?? allNodes()[0];
      if (first) focus(first.id);
    }
  }
  const visibleNode = (id) => state.visible.find((n) => n.id === id);
  const center = () => state.visible[0];
  const bounds = (point = { x: 0, y: 0 }) => {
    const nodes = state.visible.length ? state.visible : [{ x: 0, y: 0, w: 160, h: 60 }];
    return {
      l: point.x + Math.min(...nodes.map((n) => n.x - n.w / 2)) - 50,
      r: point.x + Math.max(...nodes.map((n) => n.x + n.w / 2)) + 50,
      t: point.y + Math.min(...nodes.map((n) => n.y - n.h / 2)) - 95,
      b: point.y + Math.max(...nodes.map((n) => n.y + n.h / 2)) + 50,
    };
  };
  function hit(x, y) {
    for (const node of [...state.visible].reverse())
      if (Math.abs(x - node.x) <= node.w / 2 && Math.abs(y - node.y) <= node.h / 2) return node;
    return null;
  }
  function nodeRelations(id) {
    return allEdges().filter((edge) => edge.from === id || edge.to === id);
  }
  const sourceInfo = () => ({
    status: state.status, message: state.message, connected: !!state.graph,
    exportedAt: state.graph?.exportedAt ?? null, revision: state.graph?.source?.revision ?? null,
    authority: state.graph?.source?.authority ?? null,
    counts: state.graph?.counts ?? null, warnings: state.graph?.warnings ?? null,
    ageSeconds: state.ageSeconds,
  });
  function draw(ctx, point, colors) {
    ctx.save(); ctx.translate(point.x, point.y);
    const ink = colors.ink, muted = colors.muted, paper = colors.paper, outline = colors.strong;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = muted; ctx.font = "500 12px " + colors.body;
    if (!state.graph) {
      ctx.fillText("Things Loop · Not connected", 0, -16);
      ctx.font = "400 11px " + colors.body;
      ctx.fillText(short(state.message || "No private local export configured", 67), 0, 7);
      ctx.restore(); return;
    }
    ctx.fillText("THINGS LOOP · LOCAL SNAPSHOT · NOT LIVE", 0, -210);
    ctx.font = "400 11px " + colors.body;
    ctx.fillText(state.graph.nodes.length + " objects · " + state.graph.edges.length +
      " relationships · " + (state.ageSeconds === null ? "age unknown" : "export age " + Math.floor(state.ageSeconds / 3600) + "h"), 0, -189);
    ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
    for (const edge of state.shownEdges) {
      const a = visibleNode(edge.from), b = visibleNode(edge.to);
      if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const node of state.visible) {
      const main = node.id === state.focusId;
      const border = node.type === "case" ? colors.accent :
        node.type === "phase" ? (colors.families?.[1]?.[0] ?? ink) :
        (colors.families?.[0]?.[0] ?? ink);
      ctx.fillStyle = paper; ctx.strokeStyle = border; ctx.lineWidth = main ? 2.2 : 1.2;
      ctx.beginPath(); ctx.roundRect(node.x - node.w / 2, node.y - node.h / 2, node.w, node.h, 12); ctx.fill(); ctx.stroke();
      ctx.font = "500 10px " + colors.body; ctx.fillStyle = muted;
      const kind = node.type === "case" ? "CASE " + words(node.properties.stage).toUpperCase() :
        node.type === "phase" ? "PHASE " + words(node.properties.phase_order) : "NOTE";
      ctx.fillText(kind, node.x, node.y - 11);
      ctx.fillStyle = ink; ctx.font = "600 12px " + colors.body;
      ctx.fillText(short(node.label, 23), node.x, node.y + 10);
    }
    ctx.restore();
  }
  globalThis.JeviewLoopGraph = Object.freeze({
    setResult, focus, center, sourceInfo, bounds, hit, draw, nodeRelations,
    visible: () => state.visible,
    byId,
  });
})();
