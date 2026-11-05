import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJeview } from "../src/jeview.ts";
import { parseThingsLoopSnapshot, readThingsLoopSnapshot } from "../src/things-loop.ts";

const revision = "a".repeat(64);
const stamp = () => new Date().toISOString();
const file = { path: "data/dogfood-note.yaml", sha256: "b".repeat(64) };
const example = () => ({
  format: "jeview.things-loop/v1", exportedAt: stamp(),
  source: { name: "Things Loop", kind: "local_export", authority: "unverified", revision, files: [{ ...file }] },
  nodes: [
    { id: "note:TEST0000000000000001", type: "note", label: "A case note",
      properties: { status: "pending", intent_labels: ["Scope"], body: "SHOULD_NOT_LEAK" },
      source: { path: file.path, id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "case:TEST0000000000000001", type: "case", label: "A case note",
      properties: { stage: "scoped", destination: "things_case", next_step: "Investigate" },
      source: { path: "data/dogfood-composite.yaml", id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "phase:TEST0000000000000001:1", type: "phase", label: "Scope",
      properties: { phase_order: 1, intent: "Scope" },
      source: { path: "data/dogfood-composite.yaml", id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "note:TEST0000000000000002", type: "note", label: "Related note",
      properties: { status: "pending", topic_labels: ["Design"] },
      source: { path: file.path, id: "TEST0000000000000002" }, evidence: "record", status: "snapshot" },
  ],
  edges: [
    { from: "case:TEST0000000000000001", to: "note:TEST0000000000000001",
      type: "based_on", rationale: "", source: { path: "data/dogfood-composite.yaml", index: 0 }, evidence: "record" },
    { from: "case:TEST0000000000000001", to: "phase:TEST0000000000000001:1",
      type: "has_phase", rationale: "", source: { path: "data/dogfood-composite.yaml", index: 1 }, evidence: "record" },
    { from: "note:TEST0000000000000002", to: "note:TEST0000000000000001",
      type: "branches_from", rationale: "Recorded source relation.",
      source: { path: "data/dogfood-links.yaml", index: 0 }, evidence: "record" },
  ],
  counts: { notes: 2, cases: 1, phases: 1, links: 1 },
  warnings: { unresolved_links: 0 },
});

test("an explicit private snapshot is validated, bounded and stripped of unsupported content", () => {
  const snapshot = example();
  const parsed = parseThingsLoopSnapshot(snapshot);
  assert.equal(parsed.counts.cases, 1);
  assert.equal(parsed.edges.at(-1)?.type, "branches_from");
  assert.equal(parsed.nodes[0]?.properties.body, undefined);
  assert.equal(JSON.stringify(parsed).includes("SHOULD_NOT_LEAK"), false);
  const dup = example();
  dup.nodes.push({ ...dup.nodes[0]! });
  assert.throws(() => parseThingsLoopSnapshot(dup), /node/);
  const dangling = example();
  dangling.edges[2]!.to = "note:missing";
  assert.throws(() => parseThingsLoopSnapshot(dangling), /relationship/);
  const badCount = example();
  badCount.counts.links = 2;
  assert.throws(() => parseThingsLoopSnapshot(badCount), /counts/);
  const badPath = example();
  badPath.source.files[0]!.path = "../secret.yaml";
  assert.throws(() => parseThingsLoopSnapshot(badPath), /structure/);
});

test("no configured snapshot or a missing one is never reported as a live connection", () => {
  assert.equal(readThingsLoopSnapshot().status, "not_configured");
  const missing = readThingsLoopSnapshot("/nonexistent/jeview-private-loop-export.json");
  assert.equal(missing.status, "unavailable");
  assert.equal(JSON.stringify(missing).includes("/nonexistent/"), false);
  const dir = mkdtempSync(join(tmpdir(), "jeview-loop-"));
  try {
    const path = join(dir, "snapshot.json");
    const older = example(); older.exportedAt = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    writeFileSync(path, JSON.stringify(older));
    const reading = readThingsLoopSnapshot(path);
    assert.equal(reading.status, "snapshot");
    if (reading.status === "snapshot") assert.equal(reading.freshness, "old_export");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the optional local GET never goes to Jev; cross-site readers and file paths are refused", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jeview-loop-"));
  const path = join(dir, "snapshot.json"); writeFileSync(path, JSON.stringify(example()));
  let upstreamCalls = 0;
  const jev = createServer((_req, res) => { upstreamCalls++; res.writeHead(500).end(); });
  await new Promise<void>((done) => jev.listen(0, "127.0.0.1", done));
  const url = "http://127.0.0.1:" + (jev.address() as { port: number }).port + "/v1/systemone";
  const app = createJeview({ dir, jevEndpoint: url, thingsLoopSnapshot: path });
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise<void>((done) => app.server.close(() => done()));
    await new Promise<void>((done) => jev.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + (app.server.address() as { port: number }).port;
  const response = await fetch(base + "/_/api/sources/things-loop");
  const payload = await response.json() as { status: string; graph: { counts: { cases: number }; nodes: unknown[] } };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.status, "snapshot");
  assert.equal(payload.graph.counts.cases, 1);
  assert.equal(upstreamCalls, 0);
  assert.equal((await fetch(base + "/_/api/sources/things-loop?path=/etc/passwd")).status, 200);
  const forbidden = await fetch(base + "/_/api/sources/things-loop", { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(forbidden.status, 403);
  assert.equal((await fetch(base + "/_/api/sources/things-loop", { method: "POST" })).status, 405);
  assert.equal(upstreamCalls, 0);
});
