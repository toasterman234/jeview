// Optional Things Loop read-only bridge. Only the explicitly configured JSON file is read.
// No filesystem paths from HTTP inputs, no parser or additional Jeview runtime dependency.
import { readFileSync, statSync } from "node:fs";

export type ThingsLoopNode = {
  id: string; type: "note" | "case" | "phase"; label: string;
  properties: Record<string, unknown>;
  source: { path: string; id: string };
  evidence: "record"; status: "snapshot";
};
export type ThingsLoopEdge = {
  from: string; to: string; type: string; rationale: string;
  source: { path: string; index: number }; evidence: "record";
};
export type ThingsLoopGraph = {
  format: "jeview.things-loop/v1"; exportedAt: string;
  source: { name: string; kind: "local_export"; authority: "unverified"; revision: string; files: { path: string; sha256: string }[] };
  counts: Record<string, number>; warnings: { unresolved_links: number };
  nodes: ThingsLoopNode[]; edges: ThingsLoopEdge[];
};
export type ThingsLoopRead =
  | { status: "not_configured"; connected: false; message: string }
  | { status: "unavailable"; connected: false; message: string }
  | { status: "snapshot"; connected: true; ageSeconds: number; freshness: "recent_export" | "old_export"; graph: ThingsLoopGraph };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit;
const pathOk = (value: unknown) => isString(value, 180) && /^(data|linkml)\/[A-Za-z0-9_./-]+\.yaml$/.test(value as string) && !(value as string).split("/").includes("..");
const digest = (value: unknown) => isString(value, 64) && /^[a-f0-9]{64}$/.test(value as string);
const nodeId = (value: unknown) => isString(value, 140) && /^(note|case|phase):[A-Za-z0-9:]+$/.test(value as string);
const allowedPredicates = new Set(["links_to", "branches_from", "prompted_by", "gates", "indicts", "derived_from", "based_on", "has_phase"]);
const maxBytes = 8 * 1024 * 1024;

export function parseThingsLoopSnapshot(value: unknown): ThingsLoopGraph {
  if (!isObject(value) || value.format !== "jeview.things-loop/v1" ||
      !isString(value.exportedAt, 60) || !Number.isFinite(Date.parse(value.exportedAt as string)) ||
      !isObject(value.source) || value.source.kind !== "local_export" || value.source.authority !== "unverified" ||
      value.source.name !== "Things Loop" || !digest(value.source.revision) ||
      !Array.isArray(value.source.files) || value.source.files.length > 12 ||
      !value.source.files.every((f: unknown) => isObject(f) && pathOk(f.path) && digest(f.sha256)) ||
      !Array.isArray(value.nodes) || value.nodes.length > 3000 ||
      !Array.isArray(value.edges) || value.edges.length > 10000 ||
      !isObject(value.counts) || !isObject(value.warnings) ||
      !Number.isSafeInteger(value.warnings.unresolved_links) || (value.warnings.unresolved_links as number) < 0) {
    throw Error("invalid Things Loop snapshot structure");
  }
  const ids = new Set<string>();
  for (const item of value.nodes) {
    if (!isObject(item) || !nodeId(item.id) ||
        !["note", "case", "phase"].includes(item.type as string) ||
        !String(item.id).startsWith(String(item.type) + ":") ||
        !isString(item.label, 160) || !isObject(item.properties) ||
        !isObject(item.source) || !pathOk(item.source.path) ||
        !isString(item.source.id, 100) ||
        item.evidence !== "record" || item.status !== "snapshot" ||
        ids.has(item.id as string)) {
      throw Error("invalid Things Loop snapshot node");
    }
    ids.add(item.id as string);
  }
  for (const item of value.edges) {
    if (!isObject(item) || !ids.has(item.from as string) || !ids.has(item.to as string) ||
        !allowedPredicates.has(item.type as string) || !isString(item.rationale, 350) ||
        !isObject(item.source) || !pathOk(item.source.path) ||
        !Number.isSafeInteger(item.source.index) || (item.source.index as number) < 0 ||
        item.evidence !== "record") {
      throw Error("invalid Things Loop snapshot relationship");
    }
  }
  const expected = {
    notes: value.nodes.filter((n: ThingsLoopNode) => n.type === "note").length,
    cases: value.nodes.filter((n: ThingsLoopNode) => n.type === "case").length,
    phases: value.nodes.filter((n: ThingsLoopNode) => n.type === "phase").length,
    links: value.edges.filter((e: ThingsLoopEdge) => !["based_on", "has_phase"].includes(e.type)).length,
  };
  if (!Object.entries(expected).every(([key, count]) => (value.counts as Record<string, unknown>)[key] === count)) {
    throw Error("Things Loop snapshot counts do not match nodes/edges");
  }
  // No additional secret/body fields are passed through from an untrusted snapshot.
  return {
    format: "jeview.things-loop/v1", exportedAt: value.exportedAt as string,
    source: {
      name: "Things Loop", kind: "local_export", authority: "unverified",
      revision: value.source.revision as string,
      files: value.source.files.map((f: {path: string; sha256: string}) => ({ path: f.path, sha256: f.sha256 })),
    },
    nodes: value.nodes.map((n: ThingsLoopNode) => ({
      id: n.id, type: n.type, label: n.label,
      properties: Object.fromEntries(Object.entries(n.properties).filter(([k]) =>
        ["status", "stage", "destination", "next_step", "next_move_by", "dispatched_ref",
         "phase_order", "intent", "intent_labels", "inferred_intent_labels", "topic_labels",
         "state_labels", "kind_labels", "stance_labels"].includes(k))),
      source: { path: n.source.path, id: n.source.id }, evidence: "record", status: "snapshot",
    })),
    edges: value.edges.map((e: ThingsLoopEdge) => ({
      from: e.from, to: e.to, type: e.type, rationale: e.rationale,
      source: { path: e.source.path, index: e.source.index }, evidence: "record",
    })),
    counts: expected,
    warnings: { unresolved_links: value.warnings.unresolved_links as number },
  };
}

export function readThingsLoopSnapshot(path?: string): ThingsLoopRead {
  if (!path) return { status: "not_configured", connected: false, message: "No local Things Loop snapshot is configured." };
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maxBytes) throw Error("not a bounded file");
    const graph = parseThingsLoopSnapshot(JSON.parse(readFileSync(path, "utf8")));
    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(graph.exportedAt)) / 1000));
    return { status: "snapshot", connected: true, ageSeconds,
      freshness: ageSeconds > 24 * 3600 ? "old_export" : "recent_export", graph };
  } catch {
    // A bad export must not disclose a private path or become a successful empty graph.
    return { status: "unavailable", connected: false, message: "The local Things Loop export is missing or invalid." };
  }
}
