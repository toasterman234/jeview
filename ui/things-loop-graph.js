// Things Loop object browser, drawn entirely on Jeview's original CanvasRenderingContext2D.
// Nodes originate in an opt-in local source snapshot; simulation overlays are NEVER source facts.
(() => {
  "use strict";
  const TYPES = ["case", "note", "phase", "process", "actor", "system", "store", "model", "check", "code", "output", "gap"];
  const SYSTEM_KINDS = new Set(["actor", "system", "store", "model", "check", "code", "process", "output", "gap"]);
  const AXES = ["intent_labels", "inferred_intent_labels", "topic_labels", "state_labels", "kind_labels", "stance_labels"];
  const label = (value) => String(value ?? "");
  const short = (s, max = 27) => label(s).length > max ? label(s).slice(0, max - 1) + "…" : label(s);
  const state = { graph: null, status: "not_configured", message: "No snapshot configured",
    ageSeconds: null, view: "objects", mode: "catalog", query: "", kinds: new Set(),
    focusId: null, visible: [], shownEdges: [], groups: [], overlay: {}, flash: null };
  const rawNodes = () => state.graph?.nodes ?? [];
  const rawEdges = () => state.graph?.edges ?? [];
  const byId = (id) => rawNodes().find((n) => n.id === id);
  const kindOf = (node) => node.type;
  const axesOf = (node) => AXES.flatMap((axis) =>
    Array.isArray(node.properties?.[axis]) ? node.properties[axis].slice(0, 8).map((v) => ({ axis, value: v })) : []);
  const labelsOf = (node) => {
    const axes = axesOf(node);
    const raw = Array.isArray(node.properties?.labels) ? node.properties.labels : [];
    return [...axes.map((x) => x.value), ...raw].filter((v, i, a) => typeof v === "string" && a.indexOf(v) === i);
  };
  function nodesMatching() {
    const q = state.query.toLowerCase().trim();
    return rawNodes().filter((node) =>
      (!state.kinds.size || state.kinds.has(node.type)) &&
      (!q || [node.label, node.id, node.type, node.properties?.stage, node.properties?.detail,
        ...labelsOf(node)].some((word) => label(word).toLowerCase().includes(q))) &&
      (state.view !== "observe" || node.evidence === "observed"));
  }
  const palette = {
    note: "#5092BB", case: "#9D77CA", phase: "#8B91A8", process: "#D38F57",
    actor: "#58A68B", system: "#6D8CA8", store: "#6FAD91", model: "#758CCC",
    check: "#D2A35B", code: "#90A3BD", output: "#A88C72", gap: "#D17B76",
  };
  const colorOf = (node, colors) => palette[node.type] ?? colors.accent;
  function mapNodes(items) {
    // Each typed cluster has its own radial constellation. All records are
    // present (no silent "top N"); search / kind filter makes dense sets usable.
    const groups = TYPES.map((type) => ({ type, nodes: items.filter((node) => kindOf(node) === type) }))
      .filter((g) => g.nodes.length);
    const ring = groups.length > 1 ? Math.max(780, groups.length * 235) : 0;
    const placed = [], banners = [];
    groups.forEach((group, index) => {
      const angle = -Math.PI / 2 + 2 * Math.PI * index / groups.length;
      const cx = ring * Math.cos(angle), cy = ring * Math.sin(angle);
      banners.push({ type: group.type, count: group.nodes.length, x: cx, y: cy });
      let cursor = 0, orbit = 135;
      // Increasing rings maintain readable angular separation at 1:1 scale.
      while (cursor < group.nodes.length) {
        const capacity = Math.max(6, Math.floor((Math.PI * 2 * orbit) / 160));
        const inRing = Math.min(capacity, group.nodes.length - cursor);
        for (let j = 0; j < inRing; j++) {
          const t = (j / inRing) * 2 * Math.PI - Math.PI / 2;
          placed.push({ ...group.nodes[cursor + j], x: cx + Math.cos(t) * orbit,
            y: cy + Math.sin(t) * orbit, w: 138, h: 52 });
        }
        cursor += inRing;
        orbit += 67;
      }
    });
    return { placed, banners };
  }
  function showAll() {
    state.mode = "catalog"; state.focusId = null;
    const items = nodesMatching(), built = mapNodes(items);
    state.visible = built.placed; state.groups = built.banners;
    const ids = new Set(state.visible.map((n) => n.id));
    state.shownEdges = rawEdges().filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    return state.visible.length;
  }
  function linkOther(edge, id) {
    return edge.from === id ? edge.to : edge.to === id ? edge.from : null;
  }
  function focus(id) {
    const root = byId(id);
    if (!root) return false;
    state.mode = "focus"; state.focusId = root.id; state.groups = [];
    const selected = [root], visited = new Set([root.id]), picked = [];
    const neighbors = (fromId) => rawEdges()
      .filter((edge) => linkOther(edge, fromId) !== null)
      .map((edge) => ({ edge, node: byId(linkOther(edge, fromId)) }))
      .filter((x) => x.node);
    const first = neighbors(id), sourceNote = first.find((x) => x.edge.type === "based_on")?.node;
    const list = [...first, ...(root.type === "case" && sourceNote ? neighbors(sourceNote.id) : [])];
    for (const { edge, node } of list) {
      if (selected.length >= 21) break;
      if (!visited.has(node.id)) { visited.add(node.id); selected.push(node); }
      if (visited.has(edge.from) && visited.has(edge.to)) picked.push(edge);
    }
    const ordered = selected.slice(1).sort((a, b) => a.type === "phase" && b.type === "phase"
      ? Number(a.properties?.phase_order ?? 0) - Number(b.properties?.phase_order ?? 0)
      : TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
    const split = Math.ceil(ordered.length / 2), left = ordered.slice(0, split), right = ordered.slice(split);
    const pos = (arr, x) => arr.forEach((n, j) => { n.x = x; n.y = (j - (arr.length - 1) / 2) * 80; });
    pos(left, -254); pos(right, 254);
    root.x = 0; root.y = 0;
    state.visible = selected.map((n) => ({ ...n, x: n.x, y: n.y, w: 164, h: 60 }));
    state.shownEdges = picked.filter((edge) => visited.has(edge.from) && visited.has(edge.to));
    return true;
  }
  function setView(view) {
    if (!["objects", "processes", "simulate", "observe"].includes(view)) return false;
    state.view = view;
    state.kinds.clear();
    if (view === "processes") {
      const p = rawNodes().find((n) => n.type === "process");
      return p ? focus(p.id) : showAll();
    }
    if (view === "simulate") {
      const target = rawNodes().find((n) => n.type === "case") ?? rawNodes().find((n) => n.type === "note");
      return target ? focus(target.id) : showAll();
    }
    showAll();
    return true;
  }
  function setSearch(query) {
    state.query = label(query).slice(0, 120);
    if (state.mode === "catalog") showAll();
  }
  function toggleType(type) {
    if (!TYPES.includes(type)) return;
    if (state.kinds.size === 1 && state.kinds.has(type)) state.kinds.clear();
    else state.kinds = new Set([type]);
    showAll();
  }
  function setResult(response) {
    state.status = response?.status ?? "unavailable";
    state.message = response?.message ?? "";
    state.graph = response?.connected && response?.graph?.format === "jeview.things-loop/v1" ? response.graph : null;
    state.ageSeconds = typeof response?.ageSeconds === "number" ? response.ageSeconds : null;
    state.focusId = null; state.visible = []; state.shownEdges = []; state.groups = []; state.overlay = {}; state.flash = null;
    state.view = "objects"; state.mode = "catalog"; state.query = ""; state.kinds.clear();
    if (state.graph) showAll();
  }
  function setSimulation(snapshot) {
    state.overlay = snapshot?.overlay ?? {};
    state.flash = snapshot?.latest?.touched ? { id: snapshot.latest.touched, at: Date.now() } : null;
    if (state.flash?.id && state.mode === "focus" && !state.visible.some((n) => n.id === state.flash.id)) focus(state.flash.id);
  }
  const sourceInfo = () => ({
    status: state.status, message: state.message, connected: !!state.graph,
    exportedAt: state.graph?.exportedAt ?? null, revision: state.graph?.source?.revision ?? null,
    authority: state.graph?.source?.authority ?? null,
    counts: state.graph?.counts ?? null, warnings: state.graph?.warnings ?? null,
    ageSeconds: state.ageSeconds,
  });
  function bounds(point = { x: 0, y: 0 }) {
    const all = state.visible.length ? state.visible : [{ x: 0, y: 0, w: 170, h: 65 }];
    return {
      l: point.x + Math.min(...all.map((n) => n.x - n.w / 2)) - 90,
      r: point.x + Math.max(...all.map((n) => n.x + n.w / 2)) + 90,
      t: point.y + Math.min(...all.map((n) => n.y - n.h / 2)) - 120,
      b: point.y + Math.max(...all.map((n) => n.y + n.h / 2)) + 65,
    };
  }
  function hit(x, y) {
    for (const n of [...state.visible].reverse()) if (Math.abs(x - n.x) <= n.w / 2 && Math.abs(y - n.y) <= n.h / 2) return n;
    return null;
  }
  const nodeRelations = (id) => rawEdges().filter((e) => e.from === id || e.to === id);
  function draw(ctx, origin, colors, zoom = 1) {
    ctx.save(); ctx.translate(origin.x, origin.y);
    const ink = colors.ink, muted = colors.muted, paper = colors.paper, outline = colors.strong;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = muted;
    ctx.font = "600 13px " + colors.body;
    if (!state.graph) {
      ctx.fillText("THINGS LOOP · SOURCE NOT CONNECTED", 0, -16);
      ctx.font = "400 12px " + colors.body;
      ctx.fillText(short(state.message || "No private local snapshot provided", 70), 0, 9);
      ctx.restore(); return;
    }
    if (state.mode === "catalog") {
      for (const group of state.groups) {
        ctx.fillStyle = colorOf({ type: group.type }, colors);
        ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(group.x, group.y, 45, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = paper; ctx.font = "600 13px " + colors.body;
        ctx.fillText(group.type.toUpperCase(), group.x, group.y - 7);
        ctx.font = "600 15px " + colors.body; ctx.fillText(String(group.count), group.x, group.y + 12);
        ctx.globalAlpha = 1;
      }
    }
    ctx.lineWidth = 1;
    // Dense catalog: only draw related lines when the viewer has zoomed in.
    const by = new Map(state.visible.map((n) => [n.id, n]));
    if (state.mode === "focus" || zoom > 0.35) for (const e of state.shownEdges) {
      const a = by.get(e.from), b = by.get(e.to);
      if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = e.evidence === "missing" ? colors.red : outline;
      ctx.globalAlpha = e.evidence === "record" ? 0.55 : 0.28; ctx.stroke(); ctx.globalAlpha = 1;
    }
    const visibleNames = state.mode === "focus" || zoom > 0.28;
    for (const node of state.visible) {
      const color = colorOf(node, colors), props = { ...node.properties, ...(state.overlay?.[node.id] ?? {}) };
      const lit = state.flash?.id === node.id && Date.now() - state.flash.at < 1300;
      if (lit) {
        ctx.beginPath(); ctx.arc(node.x, node.y, 42 + (Date.now() - state.flash.at) / 65, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.accent; ctx.lineWidth = 3; ctx.globalAlpha = 0.65; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.roundRect(node.x - node.w / 2, node.y - node.h / 2, node.w, node.h, 11);
      ctx.fillStyle = paper; ctx.strokeStyle = node.status === "historical" ? outline : color;
      ctx.lineWidth = node.id === state.focusId ? 2.5 : 1.3;
      if (node.status === "historical") ctx.setLineDash([4, 3]);
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (!visibleNames) {
        ctx.beginPath(); ctx.arc(node.x, node.y, 7, 0, 2 * Math.PI);
        ctx.fillStyle = color; ctx.fill();
        continue;
      }
      ctx.font = "600 10px " + colors.body; ctx.fillStyle = color;
      const stateWord = props.stage || props.status || (node.status === "historical" ? node.evidence : "");
      ctx.fillText(short(node.type.toUpperCase() + (stateWord ? " · " + String(stateWord).toUpperCase() : ""), 28),
        node.x, node.y - 15);
      ctx.fillStyle = ink; ctx.font = "600 12px " + colors.body; ctx.fillText(short(node.label, 25), node.x, node.y + 2);
      const flags = labelsOf(node);
      const bottom = state.overlay?.[node.id] ? "SIMULATED · NOT SAVED" : flags.slice(0, 2).join(" · ") ||
        (node.status === "historical" ? "HISTORICAL TOPOLOGY" : "SOURCE RECORD");
      ctx.fillStyle = state.overlay?.[node.id] ? colors.accent : muted;
      ctx.font = "400 9px " + colors.body; ctx.fillText(short(bottom, 30), node.x, node.y + 19);
    }
    ctx.restore();
  }
  globalThis.JeviewLoopGraph = Object.freeze({
    setResult, sourceInfo, bounds, hit, draw, nodeRelations,
    showAll, focus, center: () => state.visible.find((n) => n.id === state.focusId) ?? state.visible[0] ?? null,
    visible: () => state.visible, all: () => rawNodes(), edges: () => rawEdges(), cases: () => rawNodes().filter((n) => n.type === "case"),
    processes: () => rawNodes().filter((n) => n.type === "process"), byId, labelsOf, axesOf,
    facets: () => TYPES.map((type) => ({ type, count: rawNodes().filter((n) => n.type === type).length })).filter((x) => x.count),
    mode: () => state.mode, perspective: () => state.view, setView, setSearch, toggleType,
    search: () => state.query, selectedType: () => [...state.kinds][0] ?? null,
    setSimulation, overlayFor: (id) => state.overlay?.[id] ?? null,
  });
})();
