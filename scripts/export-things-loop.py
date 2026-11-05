#!/usr/bin/env python3
"""Export a *private*, read-only Things Loop graph snapshot for local Jeview.

Run with Things Loop's existing Python environment (PyYAML is already in its
requirements). Jeview itself still needs only Node 24; it never runs Python.
No note bodies, raw captures, credentials, or agent sessions are exported.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timezone

import yaml

FORMAT = "jeview.things-loop/v1"
ID = re.compile(r"^[A-Za-z0-9]{12,64}$")
PREDICATES = {"links_to", "branches_from", "prompted_by", "gates", "indicts", "derived_from"}
SOURCES = [
    ("data/dogfood-note.yaml", "notes", "note"),
    ("linkml/notes-38-labelled.yaml", "notes", "note"),
    ("data/dogfood-composite.yaml", "cases", "case"),
    ("linkml/composites.yaml", "cases", "case"),
    ("data/dogfood-links.yaml", "links", "link"),
]
OVERLAY = ("data/highlight-comments.yaml", None, "overlay")
AXES = ("intent_labels", "inferred_intent_labels", "topic_labels", "state_labels",
        "kind_labels", "stance_labels")


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Invalid Things Loop object identifier")
    return value


def string(value, limit=350):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("Expected a string in Things Loop source")
    return value[:limit]


def load(root, rel, required=True):
    file = root / rel
    if not file.is_file():
        if required:
            raise FileNotFoundError("Missing required Things Loop source: " + rel)
        return None
    data = file.read_bytes()
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("Source exceeds per-file bound: " + rel)
    parsed = yaml.safe_load(data)
    if not isinstance(parsed, dict):
        raise ValueError("Expected Things Loop mapping: " + rel)
    return parsed, {"path": rel, "sha256": hashlib.sha256(data).hexdigest()}


def export(root):
    loaded = []
    for rel, key, kind in SOURCES:
        parsed, info = load(root, rel)
        if not isinstance(parsed.get(key), list):
            raise ValueError("Missing collection " + key + " in " + rel)
        loaded.append((parsed, info, key, kind))
    overlay = load(root, OVERLAY[0], False)
    if overlay:
        parsed, info = overlay
        for key, kind in (("notes", "note"), ("links", "link")):
            if key in parsed:
                if not isinstance(parsed[key], list):
                    raise ValueError("Invalid overlay collection: " + key)
                loaded.append((parsed, info, key, kind))
    files = {info["path"]: info for _, info, _, _ in loaded}
    nodes, edges, notes = [], [], {}
    seen = set()
    missing_links = 0

    def node(node_id, kind, label, props, rel, source_id):
        if node_id in seen:
            raise ValueError("Duplicate Things Loop node id")
        seen.add(node_id)
        nodes.append({
            "id": node_id, "type": kind, "label": string(label, 160),
            "properties": props, "source": {"path": rel, "id": source_id},
            "evidence": "record", "status": "snapshot",
        })

    def edge(src, dst, kind, rel, index, rationale=""):
        edges.append({
            "from": src, "to": dst, "type": kind,
            "rationale": string(rationale, 350),
            "source": {"path": rel, "index": index},
            "evidence": "record",
        })

    for parsed, info, key, kind in loaded:
        if kind != "note":
            continue
        for note in parsed[key]:
            if not isinstance(note, dict):
                raise ValueError("Invalid Note")
            uuid = identifier(note.get("uuid"))
            title = string(note.get("title"))
            if not title:
                raise ValueError("Note missing title")
            labels = {}
            for axis in AXES:
                raw = note.get(axis) or []
                if not isinstance(raw, list) or not all(isinstance(v, str) for v in raw):
                    raise ValueError("Invalid Note label axis")
                labels[axis] = [string(v, 80) for v in raw[:24]]
            notes[uuid] = title
            node("note:" + uuid, "note", title, {
                "status": string(note.get("status"), 40), **labels,
            }, info["path"], uuid)

    for parsed, info, key, kind in loaded:
        if kind != "case":
            continue
        for case in parsed[key]:
            if not isinstance(case, dict):
                raise ValueError("Invalid CompositeCase")
            uuid = identifier(case.get("note_uuid"))
            case_id = "case:" + uuid
            node(case_id, "case", notes.get(uuid, "Case " + uuid), {
                "stage": string(case.get("stage"), 40),
                "destination": string(case.get("destination"), 80),
                "next_step": string(case.get("next_step"), 220),
                "next_move_by": string(case.get("next_move_by"), 100),
                "dispatched_ref": string(case.get("dispatched_ref"), 220),
            }, info["path"], uuid)
            if "note:" + uuid in seen:
                edge(case_id, "note:" + uuid, "based_on", info["path"], 0)
            phases = case.get("phases") or []
            if not isinstance(phases, list):
                raise ValueError("Invalid Case phases")
            orders = set()
            for phase in phases:
                if not isinstance(phase, dict):
                    raise ValueError("Invalid Phase")
                order = phase.get("phase_order")
                if not isinstance(order, int) or isinstance(order, bool) or order < 0 or order > 1000 or order in orders:
                    raise ValueError("Invalid or duplicate phase order")
                orders.add(order)
                intent = string(phase.get("intent"), 100)
                if not intent:
                    raise ValueError("Phase missing intent")
                phase_id = "phase:" + uuid + ":" + str(order)
                node(phase_id, "phase", intent, {"phase_order": order, "intent": intent},
                     info["path"], uuid)
                edge(case_id, phase_id, "has_phase", info["path"], order)

    for parsed, info, key, kind in loaded:
        if kind != "link":
            continue
        for index, link in enumerate(parsed[key]):
            if not isinstance(link, dict):
                raise ValueError("Invalid NoteLink")
            src = "note:" + identifier(link.get("source_uuid"))
            dst = "note:" + identifier(link.get("target_uuid"))
            predicate = string(link.get("predicate"), 40)
            if predicate not in PREDICATES:
                raise ValueError("Unsupported NoteLink predicate")
            if src not in seen or dst not in seen:
                missing_links += 1
                continue  # Never fabricate orphan target/source nodes.
            edge(src, dst, predicate, info["path"], index, link.get("rationale"))

    signature = hashlib.sha256()
    for file in sorted(files.values(), key=lambda f: f["path"]):
        signature.update(file["path"].encode("utf8") + b"\0" + file["sha256"].encode("ascii") + b"\n")
    return {
        "format": FORMAT, "exportedAt": datetime.now(timezone.utc).isoformat(),
        "source": {"name": "Things Loop", "kind": "local_export", "authority": "unverified",
                   "revision": signature.hexdigest(), "files": list(files.values())},
        "nodes": nodes, "edges": edges,
        "warnings": {"unresolved_links": missing_links},
        "counts": {"notes": sum(n["type"] == "note" for n in nodes),
                   "cases": sum(n["type"] == "case" for n in nodes),
                   "phases": sum(n["type"] == "phase" for n in nodes),
                   "links": sum(e["type"] in PREDICATES for e in edges)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Read-only Things Loop root (Mac home of record preferred)")
    parser.add_argument("--out", required=True, help="Local JSON snapshot path, outside the source Git tree")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve(strict=True)
    out = Path(args.out).expanduser().resolve()
    if out.is_relative_to(root):
        parser.error("Refusing to write a private export into the Things Loop source tree")
    if out.is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error("Refusing to write a private export into the public Jeview source tree")
    result = export(root)
    out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
    if len(payload) > 8 * 1024 * 1024:
        parser.error("Snapshot exceeds the 8 MiB API bound")
    fd, temporary = tempfile.mkstemp(prefix=".jeview-export-", suffix=".json", dir=out.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, out)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    os.chmod(out, 0o600)
    print(json.dumps({"ok": True, "counts": result["counts"],
                      "unresolved_links": result["warnings"]["unresolved_links"],
                      "exportedAt": result["exportedAt"],
                      "source_revision": result["source"]["revision"]}))


if __name__ == "__main__":
    main()
