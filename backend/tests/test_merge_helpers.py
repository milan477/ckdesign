import unittest

from backend.app.routers.merge import (
    _assemble_merged_entries,
    _build_conflict_payload,
    _normalize_board_nodes,
)


def _node(node_id: str, node_type: str, title: str, parent_id: str | None = None) -> dict:
    return {
        "id": node_id,
        "type": node_type,
        "title": title,
        "desc": f"{title} description",
        "parentId": parent_id,
        "sourceParentIds": [parent_id] if parent_id else [],
        "sequence": 1,
    }


def _board(owner: str, concept_title: str, knowledge_title: str) -> dict:
    return {
        "owner_name": owner,
        "ck_nodes": {
            "confirmedInitialConcept": {"title": "Shared root", "requirements": ""},
            "nodes": [
                _node("C0", "concept", "Shared root"),
                _node("C1", "concept", concept_title, "C0"),
                _node("K0", "knowledge", knowledge_title, "C1"),
            ],
        },
    }


class MergeHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.board_a = _board("alice", "Solar canopy", "Solar output varies")
        self.board_b = _board("bob", "Covered bike network", "Rain affects cycling")

    def test_same_local_ids_are_namespaced_by_source_board(self) -> None:
        nodes_a = _normalize_board_nodes(self.board_a, "a")
        nodes_b = _normalize_board_nodes(self.board_b, "b")

        self.assertIn("a:C1", {node["merge_ref"] for node in nodes_a})
        self.assertIn("b:C1", {node["merge_ref"] for node in nodes_b})
        self.assertIn("a:K0", {node["merge_ref"] for node in nodes_a})
        self.assertIn("b:K0", {node["merge_ref"] for node in nodes_b})

    def test_assembly_preserves_both_boards_and_remaps_parent_ids(self) -> None:
        merged = _assemble_merged_entries([], self.board_a, self.board_b)
        entries = merged["entries"]

        self.assertEqual(len({entry["id"] for entry in entries}), len(entries))
        self.assertEqual(sum(entry["id"] == "C0" for entry in entries), 1)
        self.assertEqual(
            {entry["title"] for entry in entries},
            {
                "Shared root",
                "Solar canopy",
                "Covered bike network",
                "Solar output varies",
                "Rain affects cycling",
            },
        )

        concept_by_title = {
            entry["title"]: entry["id"]
            for entry in entries
            if entry["type"] == "concept"
        }
        knowledge_by_title = {
            entry["title"]: entry
            for entry in entries
            if entry["type"] == "knowledge"
        }
        self.assertEqual(
            knowledge_by_title["Solar output varies"]["parent_id"],
            concept_by_title["Solar canopy"],
        )
        self.assertEqual(
            knowledge_by_title["Rain affects cycling"]["parent_id"],
            concept_by_title["Covered bike network"],
        )

    def test_conflict_choice_removes_only_the_rejected_source_node(self) -> None:
        concept_a = next(
            node for node in _normalize_board_nodes(self.board_a, "a")
            if node["merge_ref"] == "a:C1"
        )
        concept_b = next(
            node for node in _normalize_board_nodes(self.board_b, "b")
            if node["merge_ref"] == "b:C1"
        )
        conflict = {
            "id": "conflict-1",
            "conflict_type": "duplicate_concept",
            "node_a": _build_conflict_payload(concept_a),
            "node_b": _build_conflict_payload(concept_b),
            "resolution": {"choice": "a"},
        }

        merged = _assemble_merged_entries([conflict], self.board_a, self.board_b)
        titles = {entry["title"] for entry in merged["entries"]}

        self.assertIn("Solar canopy", titles)
        self.assertNotIn("Covered bike network", titles)
        self.assertIn("Rain affects cycling", titles)


if __name__ == "__main__":
    unittest.main()
