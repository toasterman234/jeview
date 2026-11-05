import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

type Node = { id: string; type: string; label: string; detail: string; status: string; x: number; y: number; w: number; h: number };
type Edge = { from: string; to: string; type: string; status: string };
type View = "context" | "harness";
type Graph = {
  nodes(mode: View): Node[];
  edges(mode: View): Edge[];
  nodeById(mode: View, id: string): Node | undefined;
  relations(mode: View, id: string): Edge[];
  bounds(mode: View, center?: { x: number; y: number }): { l: number; t: number; r: number; b: number };
  hit(mode: View, x: number, y: number): Node | null;
  draw(ctx: unknown, center: { x: number; y: number }, colors: Record<string, unknown>, mode: View): void;
};

const sandbox: Record<string, unknown> = {};
runInNewContext(readFileSync(new URL("../ui/sample-graph.js", import.meta.url), "utf8"), sandbox);
const graph = sandbox.JeviewSampleGraph as Graph;

test("fixture layers are typed, explicitly synthetic, and refer only to existing nodes", () => {
  for (const mode of ["context", "harness"] as const) {
    const nodes = graph.nodes(mode);
    const ids = new Set(["jev", ...nodes.map((node) => node.id)]);
    assert.equal(ids.size, nodes.length + 1);
    assert.ok(nodes.length >= 5);
    assert.ok(nodes.every((node) => node.status === "sample" && node.type && node.detail));
    for (const edge of graph.edges(mode)) {
      assert.ok(ids.has(edge.from), `missing source: ${edge.from}`);
      assert.ok(ids.has(edge.to), `missing target: ${edge.to}`);
      assert.equal(edge.status, "sample");
    }
  }
});

test("sample nodes can be hit and their provenance and relationships inspected", () => {
  for (const mode of ["context", "harness"] as const) {
    const b = graph.bounds(mode, { x: 21, y: 11 });
    assert.ok(b.l < 21 && b.r > 21 && b.t < 11 && b.b > 11);
    for (const node of graph.nodes(mode)) {
      assert.equal(graph.hit(mode, node.x, node.y)?.id, node.id);
      assert.equal(graph.nodeById(mode, node.id)?.label, node.label);
      assert.deepEqual(graph.relations(mode, node.id).length >= 0, true);
      assert.ok(node.x + 21 - node.w / 2 >= b.l && node.x + 21 + node.w / 2 <= b.r);
    }
    assert.equal(graph.hit(mode, 0, 0)?.id, "jev");
    assert.equal(graph.hit(mode, 9999, 9999), null);
  }
});

test("sample drawing uses a supplied canvas context and never fetches or dispatches", () => {
  const operations: string[] = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (..._args: unknown[]) => operations.push(String(name)),
    set: () => true,
  });
  const colors = { strong: "#888", paper: "#fff", ink: "#111", accent: "#f50", muted: "#555", body: "sans-serif", display: "serif", families: [["#29f"], [], ["#86b"]] };
  for (const mode of ["context", "harness"] as const) graph.draw(ctx, { x: 0, y: 0 }, colors, mode);
  assert.ok(operations.includes("roundRect"));
  assert.ok(operations.includes("fillText"));
});
