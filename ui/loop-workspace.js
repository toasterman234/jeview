// Compact, editable sandbox controls for Jeview's source-backed Object Map.
// Definitions are local browser drafts. This module never posts to Things Loop or Jev.
(() => {
  "use strict";
  const graph = globalThis.JeviewLoopGraph, Sim = globalThis.JeviewLoopSimulation;
  const STORAGE = "jeview.loop.simulated-processes.v1";
  const options = (list, selected, h) => list.map(([v, text]) => h("option", { value: v, selected: v === selected }, text));
  const source = () => graph.sourceInfo();
  const asText = (v) => String(v ?? "");
  const ellipse = (v, n = 54) => asText(v).length > n ? asText(v).slice(0, n - 1) + "…" : asText(v);
  const freshStep = () => ({ guard: "always", guardValue: "", effect: "highlight", effectValue: "" });
  let definitions = [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || "[]");
    if (Array.isArray(stored)) definitions = stored.slice(0, 20).map((x) => {
      try { return Sim.validate(x); } catch { return null; }
    }).filter(Boolean);
  } catch { /* browser storage not required */ }
  let draft = structuredClone(Sim.DEFAULT);
  let runtime = null, activeTarget = null, notice = "", frameToken = 0;
  const setNotice = (word) => { notice = asText(word).slice(0, 180); };
  function saveDefinitions() {
    try { localStorage.setItem(STORAGE, JSON.stringify(definitions)); }
    catch { setNotice("Browser storage is unavailable: this is an unsaved, in-memory draft."); }
  }
  function status() { return runtime?.snapshot() ?? { phase: "idle", events: [], overlay: {}, targetId: null, latest: null }; }
  function reset() {
    ++frameToken; runtime = null; graph.setSimulation(null);
  }
  function chooseDefinition(id) {
    const found = definitions.find((d) => d.id === id) ?? Sim.DEFAULT;
    draft = structuredClone(found);
    reset(); setNotice("");
  }
  function updateDraftFromForm(root) {
    const value = (id) => root.querySelector('[name="' + id + '"]')?.value ?? "";
    const count = Math.min(8, root.querySelectorAll(".loop-step").length);
    draft = {
      id: value("process_id"), name: value("process_name"), trigger: value("process_trigger"),
      targetType: value("target_type"), steps: Array.from({ length: count }, (_, index) => ({
        guard: value("guard_" + index), guardValue: value("guard_value_" + index),
        effect: value("effect_" + index), effectValue: value("effect_value_" + index),
      })),
    };
    return draft;
  }
  function saveDraft(root) {
    try {
      const definition = Sim.validate(updateDraftFromForm(root));
      definitions = [...definitions.filter((d) => d.id !== definition.id), definition].slice(-20);
      saveDefinitions(); draft = structuredClone(definition);
      reset(); setNotice("Saved as a browser-only simulation draft. It is NOT a Things Loop process.");
    } catch (error) { setNotice(error.message); }
  }
  function compileAndStart(root) {
    try {
      const definition = Sim.validate(updateDraftFromForm(root));
      const matching = graph.all().filter((node) => node.type === definition.targetType);
      const targetId = root.querySelector('[name="sim_target"]')?.value ?? matching[0]?.id;
      const target = graph.byId(targetId);
      if (!target) throw Error("No recorded object of type " + definition.targetType + " is available.");
      activeTarget = targetId;
      runtime = Sim.create({ nodes: graph.all() }, definition);
      runtime.start(definition.trigger, targetId);
      graph.focus(targetId); graph.setSimulation(runtime.snapshot());
      setNotice("Started an isolated simulation. No source records or agents were changed.");
      return true;
    } catch (error) { runtime = null; graph.setSimulation(null); setNotice(error.message); return false; }
  }
  function next(root, refresh) {
    if (!runtime && !compileAndStart(root)) { refresh(); return; }
    runtime.step(); graph.setSimulation(runtime.snapshot()); refresh();
  }
  function play(root, refresh, restart = false) {
    if (restart) reset();
    if (!runtime && !compileAndStart(root)) { refresh(); return; }
    const token = ++frameToken;
    function tick() {
      if (token !== frameToken || !runtime) return;
      const step = runtime.step();
      graph.setSimulation(runtime.snapshot()); refresh();
      if (step && !["denied", "completed"].includes(runtime.snapshot().phase)) setTimeout(tick, 390);
    }
    tick();
  }
  const typeChoice = [["case", "Case"], ["note", "Note"], ["phase", "Phase"],
    ["process", "Process"], ["actor", "Actor"], ["system", "System"], ["store", "Store"]];
  const guardChoice = [["always", "Always"], ["stage_is", "Case stage equals"], ["status_is", "Note status equals"], ["has_intent", "Intent label includes"]];
  const effectChoice = [["highlight", "Highlight target"], ["set_stage", "Set hypothetical Case stage"],
    ["set_status", "Set hypothetical Note status"], ["emit", "Would emit an event"]];
  function nodeList(h, items, focus, max = 140) {
    if (!items.length) return h("p", { class: "quiet" }, "No matching source-backed objects.");
    return h("ol", { class: "qlist loop-list" }, items.slice(0, max).map((item) =>
      h("li", { class: graph.center()?.id === item.id ? "here" : "" },
        h("button", { onclick: () => focus(item.id) },
          h("span", { class: "qtext" }, ellipse(item.label)),
          h("span", { class: "qmeta" }, item.type + " · " +
            (item.properties?.stage ?? item.properties?.status ?? item.evidence ?? "record"),
            item.type === "note" ? " · " + graph.labelsOf(item).slice(0, 2).join(", ") : "")))),
    items.length > max ? h("p", { class: "quiet" }, (items.length - max) + " more objects remain on the canvas; use type filters or search.") : null);
  }
  const head = (h, title, more) => h("div", { class: "loop-head" },
    h("p", { class: "eyebrow" }, title), more ? h("span", { class: "loop-count" }, more) : null);
  function render(root, h, hooks) {
    const view = graph.perspective(), info = source();
    const layout = h("div", { class: "corner-inner loop-corner" });
    const body = h("div", { class: "corner-body loop-body" });
    layout.append(head(h, ({ objects: "All objects", processes: "Recorded processes", simulate: "Sandbox simulation",
      observe: "Observed evidence" })[view], info.connected ? graph.all().length + " objects" : "Disconnected"));
    layout.append(h("p", { class: "stats-meta loop-state" }, info.connected ?
      "Local export · NOT LIVE · " + Math.floor(info.ageSeconds / 3600) + "h old · revision " +
        info.revision.slice(0, 10) : info.message || "No source export configured"));
    const navigate = (id) => { graph.focus(id); hooks.changed(); };
    if (view === "objects") {
      const find = h("form", { class: "loop-search", onsubmit: (event) => {
        event.preventDefault(); graph.setSearch(event.target.querySelector("input")?.value ?? "");
        graph.showAll(); hooks.changed();
      } }, h("input", { type: "search", value: graph.search(), placeholder: "Find objects, types, labels…", "aria-label": "Find Things Loop objects" }),
      h("button", { type: "submit", class: "ghost small" }, "Find"));
      body.append(find);
      body.append(h("div", { class: "loop-actions" },
        h("button", { class: "ghost small", onclick: () => { graph.showAll(); hooks.changed(); } }, "All objects"),
        h("button", { class: "ghost small", onclick: () => { graph.setSearch(""); graph.showAll(); hooks.changed(); } }, "Clear search")));
      body.append(h("div", { class: "loop-facets" }, graph.facets().map(({ type, count }) =>
        h("button", { class: "loop-chip", "aria-pressed": String(graph.selectedType() === type),
          onclick: () => { graph.toggleType(type); hooks.changed(); } }, type, h("span", {}, count)))));
      body.append(head(h, "Object inventory · " + graph.visible().length + " shown"));
      body.append(nodeList(h, graph.visible().map((x) => graph.byId(x.id)).filter(Boolean)
        .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label)), navigate));
    } else if (view === "processes") {
      const processes = graph.processes();
      body.append(h("p", { class: "quiet" }, "These are extracted historical system processes, not executable process definitions."));
      body.append(h("div", { class: "loop-actions" },
        h("button", { class: "ghost small", onclick: () => {
          draft = structuredClone(Sim.DEFAULT); reset(); hooks.switchTo("simulate");
        } }, "Blank simulation")));
      if (processes.length) {
        const chooser = h("select", { "aria-label": "Choose a recorded process to model" },
          options(processes.map((p) => [p.id, ellipse(p.label, 35)]), processes[0].id, h));
        body.append(h("div", { class: "loop-actions" }, chooser,
          h("button", { class: "ghost small", onclick: () => {
            const p = graph.byId(chooser.value);
            if (!p) return;
            // Model the chosen process as an entirely new WHAT-IF draft.
            // No behavior/guard is inferred as authoritative from its prose.
            draft = {
              id: ("preview-" + p.id.replace(/[^a-zA-Z0-9_-]/g, "-")).slice(0, 70),
              name: ellipse(p.label, 80), trigger: ("source." + p.id.replace(/[^a-zA-Z0-9_-]/g, "-")).slice(0, 95),
              targetType: graph.cases().length ? "case" : "note",
              steps: [freshStep()],
            };
            reset(); setNotice("Modeling a historical process as a NEW sandbox draft. Its real behavior was not imported.");
            hooks.switchTo("simulate");
          } }, "Model in sandbox")));
      }
      body.append(nodeList(h, processes, navigate, 100));
      if (!processes.length) body.append(h("p", { class: "quiet" }, "The optional system-graph/graph.json topology is missing from this export."));
    } else if (view === "observe") {
      const edges = graph.edges().filter((e) => e.evidence === "observed");
      body.append(h("p", { class: "quiet" }, "NOT LIVE. These are source assertions from a historical topology snapshot. No current event journal, run telemetry or live effect feed is connected."));
      body.append(head(h, "Historical observed edges · " + edges.length));
      body.append(h("ol", { class: "loop-trace" }, edges.slice(0, 85).map((edge) => h("li", {},
        h("b", {}, (graph.byId(edge.from)?.label ?? edge.from) + " → " + (graph.byId(edge.to)?.label ?? edge.to)),
        h("small", {}, edge.type + " · " + ellipse(edge.rationale, 110))))));
    } else if (view === "simulate") {
      body.append(h("p", { class: "quiet" }, "Compose event → guard → effects. All transitions and emitted events exist ONLY in this browser sandbox. No source writes or dispatch."));
      body.append(h("div", { class: "loop-actions" },
        h("button", { class: "ghost small", onclick: () => { chooseDefinition(Sim.DEFAULT.id); hooks.changed(); } }, "New draft"),
        definitions.length ? h("select", { "aria-label": "Load saved process", onchange: (event) => {
          chooseDefinition(event.target.value); hooks.changed();
        } }, options([[Sim.DEFAULT.id, "Example template"], ...definitions.map((d) => [d.id, d.name])], draft.id, h)) : null));
      const targets = graph.all().filter((x) => x.type === draft.targetType);
      const selectedTarget = targets.find((x) => x.id === activeTarget) ??
        targets.find((x) => x.properties?.stage === "scoped") ?? targets[0];
      const field = (title, name, value) => h("label", { class: "loop-field" }, h("span", {}, title),
        h("input", { name, value: value ?? "", maxlength: 100 }));
      const select = (title, name, values, current) => h("label", { class: "loop-field" }, h("span", {}, title),
        h("select", { name }, options(values, current, h)));
      const form = h("form", { id: "loop-process-form", class: "loop-form", onsubmit: (event) => {
        event.preventDefault(); saveDraft(event.currentTarget); hooks.changed();
      } },
        field("Process name", "process_name", draft.name),
        field("Process ID", "process_id", draft.id),
        field("Trigger event", "process_trigger", draft.trigger),
        h("label", { class: "loop-field" }, h("span", {}, "Target object type"),
          h("select", { name: "target_type", onchange: (event) => {
            updateDraftFromForm(event.target.closest("form")); reset(); hooks.changed();
          } }, options(typeChoice, draft.targetType, h))),
        h("p", { class: "eyebrow" }, "Steps · up to 8"),
        ...draft.steps.map((step, i) => h("div", { class: "loop-step" },
          h("p", { class: "stats-meta" }, "Step " + (i + 1)),
          select("Guard", "guard_" + i, guardChoice, step.guard),
          field("Guard value", "guard_value_" + i, step.guardValue),
          select("Effect", "effect_" + i, effectChoice, step.effect),
          field("Effect value", "effect_value_" + i, step.effectValue))),
        h("div", { class: "loop-actions" },
          h("button", { class: "ghost small", type: "button", onclick: (event) => {
            updateDraftFromForm(event.currentTarget.closest("form"));
            if (draft.steps.length < 8) draft.steps.push(freshStep());
            reset(); hooks.changed();
          } }, "+ Step"),
          draft.steps.length > 1 ? h("button", { class: "ghost small", type: "button", onclick: (event) => {
            updateDraftFromForm(event.currentTarget.closest("form")); draft.steps.pop();
            reset(); hooks.changed();
          } }, "− Step") : null,
          h("button", { class: "ghost small", type: "submit" }, "Save local draft")),
        select("Event target", "sim_target",
          targets.slice(0, 200).map((item) => [item.id, ellipse(item.label, 55)]), selectedTarget?.id),
        h("div", { class: "loop-actions" },
          h("button", { class: "ghost small", type: "button", onclick: () => {
            reset(); compileAndStart(form); graph.setSimulation(status()); hooks.changed();
          } }, "Start"),
          h("button", { class: "ghost small", type: "button", onclick: () => next(form, hooks.changed) }, "Step"),
          h("button", { class: "ghost small", type: "button", onclick: () => play(form, hooks.changed, true) }, "Play"),
          h("button", { class: "ghost small", type: "button", onclick: () => play(form, hooks.changed, true) }, "Replay"),
          h("button", { class: "ghost small", type: "button", onclick: () => {
            reset(); hooks.changed();
          } }, "Reset")));
      body.append(form);
      if (notice) body.append(h("p", { class: "loop-notice", role: "status" }, notice));
      const trace = status();
      body.append(head(h, "Simulated trace · " + trace.phase));
      body.append(h("ol", { class: "loop-trace" }, trace.events.map((event) => h("li", {},
        h("b", {}, event.index + " · " + event.step + " · " + event.status),
        h("small", {}, event.detail)))));
    }
    layout.append(body); root.replaceChildren(layout);
  }
  globalThis.JeviewLoopWorkspace = Object.freeze({ render, reset, status, chooseDefinition });
})();
