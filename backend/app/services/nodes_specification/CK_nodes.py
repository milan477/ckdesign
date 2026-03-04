from __future__ import annotations
from enum import Enum

class CKType(Enum):
    KNOWLEDGE = 1
    CONCEPT = 2

class CKElement:
    id: str
    type: CKType
    title: str
    desc: str
    operation_rationale: str

    def __init__(self, id: str, type: CKType, title: str, desc: str, operation_rationale: str):
        self.id = id
        self.type = type
        self.title = title
        self.desc = desc
        self.operation_rationale = operation_rationale

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type.name.lower(),
            "title": self.title,
            "desc": self.desc,
            "operation_rationale": self.operation_rationale
        }


class CKNode:
    element: CKElement
    children: list[CKNode]
    parent: CKNode | None

    def __init__(self, element: CKElement):
        self.element = element
        self.children = []
        self.parent = None

    def add_child(self, child: CKNode) -> None:
        self.children.append(child)
        child.parent = self
