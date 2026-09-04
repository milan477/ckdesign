import unittest

from backend.app.routers.merge import (
    _conflict_node_ids,
    _conflict_node_payload,
    _deconflict_node_positions,
    _normalise_board_node_ids,
)


def _node(node_id: str, node_type: str, parent_id: str | None = None) -> dict:
    return {
        "id": node_id,
        "type": node_type,
        "title": f"{node_id} title",
        "desc": "",
        "parentId": parent_id,
        "sourceParentIds": [parent_id] if parent_id else [],
        "x": 100 if node_type == "concept" else 700,
        "y": 100,
        "width": 260,
        "height": 140,
        "sequence": 1,
        "elementId": f"element-{node_id}",
        "arrowId": f"arrow-{node_id}" if parent_id else None,
        "extraArrowIds": [],
    }


class MergeHelpersTest(unittest.TestCase):
    def test_independent_board_ids_are_kept_unique(self) -> None:
        board_a = {
            "user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "ck_nodes": {
                "nodes": [
                    _node("C0", "concept"),
                    _node("C1", "concept", "C0"),
                    _node("K0", "knowledge", "C1"),
                ]
            },
        }
        board_b = {
            "user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "ck_nodes": {
                "nodes": [
                    _node("C0", "concept"),
                    _node("C1", "concept", "C0"),
                    _node("K0", "knowledge", "C1"),
                ]
            },
        }

        used_ids: set[str] = set()
        normal_a = _normalise_board_node_ids(board_a, used_ids, primary=True)
        normal_b = _normalise_board_node_ids(board_b, used_ids, primary=False)

        nodes_a = normal_a["ck_nodes"]["nodes"]
        nodes_b = normal_b["ck_nodes"]["nodes"]
        all_nodes = [*nodes_a, *nodes_b]

        self.assertEqual([node["id"] for node in nodes_a], ["C0", "C1", "K0"])
        self.assertEqual([node["id"] for node in nodes_b], ["C2", "K1"])
        self.assertEqual(nodes_b[0]["parentId"], "C0")
        self.assertEqual(nodes_b[1]["parentId"], "C2")
        self.assertEqual(len({node["id"] for node in all_nodes}), len(all_nodes))
        self.assertEqual(len({node["elementId"] for node in all_nodes}), len(all_nodes))

    def test_merged_nodes_do_not_overlap_within_a_column(self) -> None:
        nodes = [
            _node("C0", "concept"),
            _node("C1", "concept", "C0"),
            _node("C2", "concept", "C0"),
            _node("K0", "knowledge", "C1"),
            _node("K1", "knowledge", "C2"),
        ]

        positioned = _deconflict_node_positions(nodes)
        for node_type in ("concept", "knowledge"):
            typed = sorted(
                (node for node in positioned if node["type"] == node_type),
                key=lambda node: node["y"],
            )
            for previous, current in zip(typed, typed[1:]):
                self.assertGreaterEqual(
                    current["y"],
                    previous["y"] + previous["height"] + 60,
                )

    def test_combination_conflicts_remain_renderable_and_resolvable(self) -> None:
        nodes = [_node("K0", "knowledge"), _node("K1", "knowledge")]

        payload = _conflict_node_payload(nodes, "alice")

        self.assertEqual(payload["id"], "K0+K1")
        self.assertEqual(payload["owner"], "alice")
        self.assertIn("K0 title", payload["title"])
        self.assertEqual(_conflict_node_ids(payload), ["K0", "K1"])


if __name__ == "__main__":
    unittest.main()
