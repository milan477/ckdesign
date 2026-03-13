from pydantic import BaseModel
from typing import List, Optional


class NodeGenerateRequest(BaseModel):
    description: str


class NodeOut(BaseModel):
    node_id: str
    type: str
    description: str


class CKEntry(BaseModel):
    id: str
    type: str
    title: str
    desc: str
    operation_rationale: str


class SimulationRequest(BaseModel):
    topic: Optional[str] = "design a creative nail holder for when a person is hammering a nail."
    initial_entry: Optional[CKEntry] = None
    knowledge_entries: Optional[List[CKEntry]] = None
    iterations: Optional[int] = 1
    simulations: Optional[int] = 1


class SimulationResponse(BaseModel):
    simulations: List[List[CKEntry]]


class ReorderRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]

class ReorderResponse(BaseModel):
    reordered_knowledge: List[CKEntry]


class CreateConceptRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]
    focus_entry_id: Optional[str] = None


class CreateConceptResponse(BaseModel):
    concept: CKEntry
    source_knowledge_ids: List[str]


class CreateKnowledgeRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]
    focus_entry_id: Optional[str] = None


class CreateKnowledgeResponse(BaseModel):
    knowledge: CKEntry
    source_concept_id: str


class ExpandConceptRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]
    focus_entry_id: Optional[str] = None


class ExpandConceptResponse(BaseModel):
    parent_concept_id: str
    concepts: List[CKEntry]


class ExpandKnowledgeRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]
    focus_entry_id: Optional[str] = None


class ExpandKnowledgeResponse(BaseModel):
    parent_knowledge_id: str
    knowledges: List[CKEntry]


class NovelConceptScores(BaseModel):
    novelty: float
    feasibility: float
    usefulness: float
    clarity: float


class DecideNovelConceptRequest(BaseModel):
    topic: str
    ck_history: List[CKEntry]


class DecideNovelConceptResponse(BaseModel):
    selected_concept_id: str
    rationale: str
    scores: NovelConceptScores
