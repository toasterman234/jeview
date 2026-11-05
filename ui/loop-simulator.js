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
    const steps = raw.steps ?? [{ guard: raw.guard, guardValue: raw.guardValue, effect: raw.effect, effectValue: raw.effectValue }];
    assert(Array.isArray(steps) && steps.length >= 1 && steps.length <= 8, "process requires 1–8 steps");
    const normalized = steps.map((step, index) => {
      assert(step && typeof step === "object", "invalid step " + index);
      assert(predicates.has(step.guard), "unknown guard");
      assert(step.guard === "always" || asWord(step.guardValue, 70), "guard value required");
      assert(actions.has(step.effect), "unknown effect");
      assert(step.effect === "highlight" || asWord(step.effectValue, 100), "effect value required");
      if (step.effect === "set_stage") {
        assert(raw.targetType === "case", "stage changes require Case");
        assert(Object.hasOwn(transitions, step.effectValue), "unknown stage");
      }
      if (step.effect === "set_status") {
        assert(raw.targetType === "note", "status changes require Note");
        assert(["pending", "completed", "cancelled"].includes(step.effectValue), "unknown note status");
      }
      return Object.freeze({ guard: step.guard, guardValue: step.guard === "always" ? "" : step.guardValue,
        effect: step.effect, effectValue: step.effect === "highlight" ? "" : step.effectValue });
    });
    return Object.freeze({ id: raw.id, name: raw.name, trigger: raw.trigger,
      targetType: raw.targetType, steps: Object.freeze(normalized) });
  }
  /* old one-step aliases are accepted at the boundary; new authored processes use `steps` */
  const DEFAULT = Object.freeze(validate({
    id: "preview-case-triage", name: "Case stage preview", trigger: "case.review",
    targetType: "case", steps: [{ guard: "stage_is", guardValue: "scoped",
      effect: "set_stage", effectValue: "working" }],
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
      queue = ["event", ...rule.steps.flatMap((_, i) => ["guard:" + i, "effect:" + i]), "outcome"];
      return { phase, targetId: node.id };
    }
    function properties() {
      if (!target) return {};
      return { ...target.properties, ...overlay.get(target.id) };
    }
    function guarded(ruleStep) {
      const props = properties();
      switch (ruleStep.guard) {
        case "always": return true;
        case "stage_is": return target.type === "case" && props.stage === ruleStep.guardValue;
        case "status_is": return target.type === "note" && props.status === ruleStep.guardValue;
        case "has_intent": return [...(Array.isArray(props.intent_labels) ? props.intent_labels : []),
          ...(Array.isArray(props.inferred_intent_labels) ? props.inferred_intent_labels : [])].includes(ruleStep.guardValue);
      }
      return false;
    }
    function step() {
      if (!queue.length) return null;
      const next = queue.shift();
      if (next === "event") { phase = "running"; return record("event", "received", rule.trigger, target.id); }
      if (next.startsWith("guard:")) {
        const number = Number(next.split(":")[1]), stepDef = rule.steps[number];
        if (!guarded(stepDef)) {
          queue = []; phase = "denied";
          return record("guard " + (number + 1), "denied", stepDef.guard +
            (stepDef.guardValue ? " " + stepDef.guardValue : "") + " not satisfied", target.id);
        }
        return record("guard " + (number + 1), "passed", stepDef.guard +
          (stepDef.guardValue ? " " + stepDef.guardValue : ""), target.id);
      }
      if (next.startsWith("effect:")) {
        const number = Number(next.split(":")[1]), stepDef = rule.steps[number];
        let effect = stepDef.effect, detail = "";
        const props = properties();
        if (effect === "set_stage") {
          if (!transitions[props.stage]?.has(stepDef.effectValue)) {
            queue = []; phase = "denied";
            return record("effect " + (number + 1), "denied", "No declared transition from " + String(props.stage) +
              " to " + stepDef.effectValue + ". The source was not changed.", target.id);
          }
          overlay.set(target.id, { ...(overlay.get(target.id) ?? {}), stage: stepDef.effectValue });
          detail = "Hypothetical Case stage " + String(props.stage) + " → " + stepDef.effectValue;
        } else if (effect === "set_status") {
          overlay.set(target.id, { ...(overlay.get(target.id) ?? {}), status: stepDef.effectValue });
          detail = "Hypothetical Note status " + String(props.status) + " → " + stepDef.effectValue;
        } else if (effect === "emit") {
          detail = "Would emit event " + stepDef.effectValue + " (not delivered)";
        } else {
          detail = "Highlight " + target.label + " (no underlying change)";
        }
        return record("effect " + (number + 1), "simulated", detail, target.id);
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
