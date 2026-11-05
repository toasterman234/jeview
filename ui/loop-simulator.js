// Local-only preview of event/guard/effect behavior. Never fetches, writes sources or dispatches.
// The application owns persisted definitions; this engine only changes its private overlay.
(() => {
  "use strict";
  const allowedTypes = new Set(["note", "case", "phase", "process", "agent", "rule", "resource", "component"]);
  const actions = new Set(["highlight", "set_stage", "set_status", "emit"]);
  const predicates = new Set(["always", "stage_is", "status_is", "has_intent"]);
  const transitions = {
    scoped: new Set(["working", "held"]),
    working: new Set(["blocked", "held", "done"]),
    blocked: new Set(["working", "held"]),
    held: new Set(["scoped"]),
    done: new Set(),
  };
  const asWord = (value, limit = 100) => typeof value === "string" && value.length > 0 &&
    value.length <= limit && /^[\w .:/-]+$/.test(value);
  const assert = (test, message) => { if (!test) throw Error("Simulation definition: " + message); };
  function validate(raw) {
    assert(raw && typeof raw === "object", "expected a definition");
    assert(asWord(raw.id, 72) && asWord(raw.name, 100), "id/name required");
    assert(asWord(raw.trigger, 100), "event trigger required");
    assert(allowedTypes.has(raw.targetType), "unknown target type");
    assert(predicates.has(raw.guard), "unknown guard");
    assert(raw.guard === "always" || asWord(raw.guardValue, 70), "guard value required");
    assert(actions.has(raw.effect), "unknown effect");
    assert(raw.effect === "highlight" || asWord(raw.effectValue, 100), "effect value required");
    if (raw.effect === "set_stage") {
      assert(raw.targetType === "case", "stage changes require Case");
      assert(Object.hasOwn(transitions, raw.effectValue), "unknown stage");
    }
    if (raw.effect === "set_status") {
      assert(raw.targetType === "note", "status changes require Note");
      assert(["pending", "completed", "cancelled"].includes(raw.effectValue), "unknown note status");
    }
    const definition = {};
    for (const key of ["id", "name", "trigger", "targetType", "guard", "effect"]) definition[key] = raw[key];
    definition.guardValue = raw.guard === "always" ? "" : raw.guardValue;
    definition.effectValue = raw.effect === "highlight" ? "" : raw.effectValue;
    return Object.freeze(definition);
  }
  const DEFAULT = Object.freeze(validate({
    id: "preview-case-triage", name: "Case stage preview", trigger: "case.review",
    targetType: "case", guard: "stage_is", guardValue: "scoped",
    effect: "set_stage", effectValue: "working",
  }));
  function create(graph, definition = DEFAULT) {
    const rule = validate(definition);
    let queue = [], phase = "idle", target = null, latest = null;
    const overlay = new Map();
    const events = [];
    const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
    let seq = 0;
    function record(step, status, detail, touched) {
      const item = Object.freeze({ index: ++seq, step, status, detail, touched: touched ?? null, simulated: true });
      events.push(item);
      latest = item;
      return item;
    }
    function reset() {
      queue = []; phase = "idle"; target = null; latest = null;
      overlay.clear(); events.length = 0; seq = 0;
    }
    function start(eventName, nodeId) {
      reset();
      assert(eventName === rule.trigger, "event does not match the configured trigger");
      const node = nodes.get(nodeId);
      assert(node?.type === rule.targetType, "target must match the configured object type");
      target = node;
      phase = "ready";
      queue = ["event", "guard", "effect", "outcome"];
      return { phase, targetId: node.id };
    }
    function properties() {
      if (!target) return {};
      return { ...target.properties, ...overlay.get(target.id) };
    }
    function guarded() {
      const props = properties();
      switch (rule.guard) {
        case "always": return true;
        case "stage_is": return target.type === "case" && props.stage === rule.guardValue;
        case "status_is": return target.type === "note" && props.status === rule.guardValue;
        case "has_intent": return [...(Array.isArray(props.intent_labels) ? props.intent_labels : []),
          ...(Array.isArray(props.inferred_intent_labels) ? props.inferred_intent_labels : [])].includes(rule.guardValue);
      }
      return false;
    }
    function step() {
      if (!queue.length) return null;
      const next = queue.shift();
      if (next === "event") { phase = "running"; return record("event", "received", rule.trigger, target.id); }
      if (next === "guard") {
        if (!guarded()) {
          queue = []; phase = "denied";
          return record("guard", "denied", rule.guard + (rule.guardValue ? " " + rule.guardValue : "") + " not satisfied", target.id);
        }
        return record("guard", "passed", rule.guard + (rule.guardValue ? " " + rule.guardValue : ""), target.id);
      }
      if (next === "effect") {
        let effect = rule.effect, detail = "";
        const props = properties();
        if (effect === "set_stage") {
          if (!transitions[props.stage]?.has(rule.effectValue)) {
            queue = []; phase = "denied";
            return record("effect", "denied", "No declared transition from " + String(props.stage) +
              " to " + rule.effectValue + ". The source was not changed.", target.id);
          }
          overlay.set(target.id, { ...(overlay.get(target.id) ?? {}), stage: rule.effectValue });
          detail = "Hypothetical Case stage " + String(props.stage) + " → " + rule.effectValue;
        } else if (effect === "set_status") {
          overlay.set(target.id, { ...(overlay.get(target.id) ?? {}), status: rule.effectValue });
          detail = "Hypothetical Note status " + String(props.status) + " → " + rule.effectValue;
        } else if (effect === "emit") {
          detail = "Would emit event " + rule.effectValue + " (not delivered)";
        } else {
          detail = "Highlight " + target.label + " (no underlying change)";
        }
        return record("effect", "simulated", detail, target.id);
      }
      phase = "completed";
      return record("outcome", "simulated", "Sandbox replay complete. No real effect was executed.", target.id);
    }
    function run() { const entries = []; let item; while ((item = step())) entries.push(item); return entries; }
    return Object.freeze({
      start, step, run, reset, definition: rule, 
      snapshot: () => ({ phase, events: [...events], targetId: target?.id ?? null, latest,
        overlay: Object.fromEntries(overlay) }),
    });
  }
  globalThis.JeviewLoopSimulation = Object.freeze({ validate, create, DEFAULT });
})();
