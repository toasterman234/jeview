import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

type Definition = { id: string; name: string; trigger: string; targetType: string;
  steps: { guard: string; guardValue?: string; effect: string; effectValue?: string }[] };
type Trace = { phase: string; events: { step: string; status: string; detail: string }[];
  overlay: Record<string, Record<string, string>>; targetId: string | null };
const context: { globalThis: Record<string, unknown> } = { globalThis: {} };
runInNewContext(readFileSync(new URL("../ui/loop-simulator.js", import.meta.url), "utf8"), context);
const sim = context.globalThis.JeviewLoopSimulation as {
  validate: (input: Definition) => Definition;
  create: (graph: unknown, definition: Definition) => {
    start: (event: string, node: string) => void;
    step: () => unknown; run: () => unknown[];
    reset: () => void; snapshot: () => Trace;
  };
};
const entry = { id: "case:ABCD123456789012", label: "Example simulated case", type: "case",
  properties: { stage: "scoped", intent_labels: ["Build"] } };
const note = { id: "note:ABCD123456789012", label: "Synthetic source note", type: "note",
  properties: { status: "pending", intent_labels: ["Build"] } };
const graph = { nodes: [entry, note] };
const make = (steps: Definition["steps"], targetType = "case"): Definition =>
  ({ id: "synthetic-test", name: "Simulated process", trigger: "test.event", targetType, steps });

test("multiple guard/effect steps change only private simulated state, not source", () => {
  const definition = make([
    { guard: "stage_is", guardValue: "scoped", effect: "set_stage", effectValue: "working" },
    { guard: "stage_is", guardValue: "working", effect: "set_stage", effectValue: "blocked" },
  ]);
  const runtime = sim.create(graph, definition);
  runtime.start("test.event", entry.id); runtime.run();
  const result = runtime.snapshot();
  assert.equal(result.phase, "completed");
  assert.equal(result.overlay[entry.id]?.stage, "blocked");
  assert.equal(entry.properties.stage, "scoped", "source record must be immutable");
  assert.equal(result.events.length, 6);
  assert.ok(result.events.every((event) => !["executed", "dispatched"].includes(event.status)));
  const firstTrace = result.events.map((event) => [event.step, event.status, event.detail]);
  runtime.start("test.event", entry.id); runtime.run();
  assert.deepEqual(runtime.snapshot().events.map((e) => [e.step, e.status, e.detail]), firstTrace);
});

test("denied guard and invalid stage transition stop the sequence without changing source", () => {
  const denied = sim.create(graph, make([
    { guard: "stage_is", guardValue: "done", effect: "set_stage", effectValue: "working" },
  ]));
  denied.start("test.event", entry.id);
  denied.run();
  assert.equal(denied.snapshot().phase, "denied");
  assert.deepEqual(Object.keys(denied.snapshot().overlay), []);
  const forbidden = sim.create(graph, make([
    { guard: "always", effect: "set_stage", effectValue: "done" },
    { guard: "always", effect: "set_stage", effectValue: "working" },
  ]));
  forbidden.start("test.event", entry.id); forbidden.run();
  assert.equal(forbidden.snapshot().phase, "denied");
  assert.equal(forbidden.snapshot().overlay[entry.id]?.stage, undefined,
    "a later denied change may not erase the original staged source");
});

test("no arbitrary action, type mismatch, or invented event can enter the simulator", () => {
  assert.throws(() => sim.validate(make([{ guard: "always", effect: "shell", effectValue: "run" }])), /unknown effect/);
  assert.throws(() => sim.validate(make([{ guard: "always", effect: "set_status", effectValue: "completed" }])), /require Note/);
  assert.throws(() => sim.validate(make(Array.from({ length: 9 }, () => ({
    guard: "always", effect: "highlight",
  })))), /1–8 steps/);
  const runtime = sim.create(graph, make([{ guard: "always", effect: "highlight" }]));
  assert.throws(() => runtime.start("unregistered", entry.id), /trigger/);
  assert.throws(() => runtime.start("test.event", note.id), /target/);
  assert.equal(runtime.snapshot().phase, "idle");
});

test("Note effect, emitted event and intent guard are sandbox-only", () => {
  const definition = make([
    { guard: "has_intent", guardValue: "Build", effect: "set_status", effectValue: "completed" },
    { guard: "status_is", guardValue: "completed", effect: "emit", effectValue: "note.proposed" },
  ], "note");
  const runtime = sim.create(graph, definition);
  runtime.start("test.event", note.id); runtime.run();
  assert.equal(runtime.snapshot().overlay[note.id]?.status, "completed");
  assert.equal(note.properties.status, "pending");
  assert.ok(runtime.snapshot().events.some((e) => e.detail.includes("not delivered")));
});
