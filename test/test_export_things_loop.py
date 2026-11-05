"""Tests for the opt-in Things Loop exporter. All source content here is synthetic."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export-things-loop.py"
spec = importlib.util.spec_from_file_location("jev_loop_export", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

NOTE = """notes:
- uuid: TEST0000000000000001
  title: 'Example: case note'
  body: 'A private body that must never be exported'
  status: pending
  intent_labels:
  - Scope
  topic_labels:
  - System
- uuid: TEST0000000000000002
  title: Related note
  body: 'Another private body'
  kind_labels:
  - Idea
"""
CASES = """cases:
- note_uuid: TEST0000000000000001
  destination: github_issue
  phases:
  - intent: Scope
    phase_order: 1
  - intent: Investigate
    phase_order: 2
  stage: scoped
  next_step: 'First phase: inspect'
  next_move_by: Tester
"""
LINKS = """links:
- source_uuid: TEST0000000000000002
  target_uuid: TEST0000000000000001
  kind: branch
  predicate: branches_from
  rationale: 'A typed lineage reason'
- source_uuid: TEST0000000000000001
  target_uuid: MISSING00000000000001
  kind: link
  predicate: links_to
  rationale: 'Orphan should be counted, not invented'
"""


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "source"
        self.root.mkdir()
        for rel, text in [
            ("data/dogfood-note.yaml", NOTE),
            ("linkml/notes-38-labelled.yaml", "notes: []\n"),
            ("data/dogfood-composite.yaml", CASES),
            ("linkml/composites.yaml", "cases: []\n"),
            ("data/dogfood-links.yaml", LINKS),
        ]:
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf8")

    def test_metadata_only_lineage_phase_and_hashes(self):
        graph = module.export(self.root)
        self.assertEqual(graph["counts"], {"notes": 2, "cases": 1, "phases": 2, "links": 1,
                                            "components": 0, "system_links": 0})
        self.assertEqual(graph["warnings"], {"unresolved_links": 1})
        self.assertEqual(graph["source"]["authority"], "unverified")
        self.assertEqual(len(graph["source"]["revision"]), 64)
        self.assertEqual(graph["edges"][-1]["type"], "branches_from")
        self.assertEqual(graph["edges"][-1]["from"], "note:TEST0000000000000002")
        self.assertEqual(graph["edges"][-1]["to"], "note:TEST0000000000000001")
        self.assertEqual([n["properties"]["phase_order"] for n in graph["nodes"] if n["type"] == "phase"], [1, 2])
        data = json.dumps(graph)
        self.assertNotIn("private body", data)
        self.assertNotIn("Orphan should be counted", data)
        self.assertNotIn(str(self.root), data)

    def test_optional_historical_system_graph_is_typed_and_evidence_marked(self):
        target = self.root / "system-graph" / "graph.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({
            "facts": {"receipt": "historical-only"},
            "nodes": [
                {"id": "process-route", "kind": "process", "label": "Route a Case",
                 "perspective": "processes", "detail": "Declared path, not executing",
                 "evidence": "declared"},
                {"id": "system-runner", "kind": "system", "label": "Event runtime",
                 "perspective": "implementation", "detail": "Not connected",
                 "evidence": "missing"},
            ],
            "edges": [{"from": "process-route", "to": "system-runner", "type": "triggers",
                       "detail": "Not yet observed", "evidence": "missing"}],
        }), encoding="utf8")
        graph = module.export(self.root)
        self.assertEqual(graph["counts"]["components"], 2)
        self.assertEqual(graph["counts"]["system_links"], 1)
        self.assertEqual(graph["nodes"][-2]["type"], "process")
        self.assertEqual(graph["nodes"][-2]["status"], "historical")
        self.assertEqual(graph["edges"][-1]["evidence"], "missing")
        self.assertIn("system-graph/graph.json", [x["path"] for x in graph["source"]["files"]])
        self.assertNotIn("historical-only", json.dumps(graph))
        # Existing Notes/Cases still refer to their own source paths/UUIDs.
        self.assertEqual(graph["nodes"][0]["type"], "note")
        self.assertEqual(graph["nodes"][0]["properties"]["intent_labels"], ["Scope"])

    def test_declared_manifest_supplies_processes_and_dependencies(self):
        target = self.root / "system-manifest.yaml"
        target.write_text("""manifest_version: '0.5'
id: test-loop
components:
- {id: process.build_pipeline, role: build_pipeline, path: rebuild.sh, represents: "ordered build"}
- {id: process.page_builders, role: generator, path: site/build_dashboard.py, represents: "page builders"}
- {id: output.pages, role: generated_view, path: site/, represents: "published pages"}
- {id: mystery.thing, role: unmodelled_role, path: x, represents: "not mapped"}
relationships:
- {from: process.build_pipeline, to: process.page_builders, type: triggers, evidence_status: observed}
- {from: process.page_builders, to: output.pages, type: produces, evidence_status: observed}
- {from: process.page_builders, to: mystery.thing, type: touches, evidence_status: observed}
""", encoding="utf8")
        graph = module.export(self.root)
        processes = [n for n in graph["nodes"] if n["type"] == "process"]
        self.assertEqual([n["label"] for n in processes], ["process.build_pipeline", "process.page_builders"])
        self.assertTrue(all(n["evidence"] == "declared" and n["status"] == "historical" for n in processes))
        self.assertTrue(all(n["source"]["path"] == "system-manifest.yaml" for n in processes))
        self.assertEqual(processes[0]["properties"]["role"], "build_pipeline")
        self.assertEqual(graph["counts"]["components"], 3)
        # The unmodelled endpoint is skipped rather than fabricated into a kind.
        self.assertEqual(graph["counts"]["system_links"], 2)
        self.assertNotIn("mystery.thing", json.dumps(graph))
        self.assertIn("system-manifest.yaml", [x["path"] for x in graph["source"]["files"]])
        # No component file paths or the unmodelled role leak into the export.
        self.assertNotIn("rebuild.sh", json.dumps(graph))

    def test_live_loop_predicate_is_exported_as_recorded(self):
        (self.root / "data" / "dogfood-links.yaml").write_text("""links:
- source_uuid: TEST0000000000000002
  target_uuid: TEST0000000000000001
  kind: link
  predicate: supersedes_direction
  rationale: 'A newer record replaces the direction of the older one'
""", encoding="utf8")
        graph = module.export(self.root)
        self.assertEqual(graph["counts"]["links"], 1)
        self.assertEqual(graph["edges"][-1]["type"], "supersedes_direction")

    def test_cli_writes_0600_snapshot_outside_source(self):
        output = Path(self.tmp.name) / "private" / "snapshot.json"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), "--out", str(output)],
            check=True, capture_output=True, text=True)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["counts"]["cases"], 1)
        self.assertTrue(output.is_file())
        self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_text())["format"], "jeview.things-loop/v1")
        self.assertNotIn("TEST0000000000000001", result.stdout)

    def test_rejects_duplicate_sources_or_unsafe_export_target(self):
        extra = self.root / "linkml" / "notes-38-labelled.yaml"
        extra.write_text(NOTE, encoding="utf8")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.export(self.root)
        extra.write_text("notes: []\n", encoding="utf8")
        denied = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root),
             "--out", str(self.root / "export.json")],
            capture_output=True, text=True)
        self.assertNotEqual(denied.returncode, 0)
        self.assertFalse((self.root / "export.json").exists())


if __name__ == "__main__":
    unittest.main()
