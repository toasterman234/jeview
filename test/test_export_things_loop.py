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
        self.assertEqual(graph["counts"], {"notes": 2, "cases": 1, "phases": 2, "links": 1})
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
