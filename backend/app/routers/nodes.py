import logging
import re

from fastapi import APIRouter
from backend.app.schemas.node import (
    CKEntry,
    CreateConceptRequest,
    CreateConceptResponse,
    CreateKnowledgeRequest,
    CreateKnowledgeResponse,
    DecideNovelConceptRequest,
    DecideNovelConceptResponse,
    ExpandConceptRequest,
    ExpandConceptResponse,
    ExpandKnowledgeRequest,
    ExpandKnowledgeResponse,
    NodeGenerateRequest,
    NodeOut,
    ReorderRequest,
    ReorderResponse,
    SimulationRequest,
    SimulationResponse,
)
from backend.app.services.nodes_generation.node_generator import generate_nodes, CKAgent

router = APIRouter(prefix="/nodes", tags=["nodes"])
logger = logging.getLogger(__name__)


@router.get("/")
async def get_dummy_node():
    return [{"node_id": "1"}, {"type": "knowledge"}]


@router.post("/generate", response_model=NodeOut)
async def generate(node: NodeGenerateRequest):
    print(node)
    return await generate_nodes(node.description)


@router.post("/simulate", response_model=SimulationResponse)
async def run_simulations(request: SimulationRequest):
    """Run simulations and return all generated results"""

    try:
        print("Received simulation request:", request)

        topic = request.topic or default["topic"]
        initial_entry = (
            request.initial_entry.model_dump()
            if request.initial_entry
            else default["initial_entry"]
        )
        knowledge_entries = (
            [entry.model_dump() for entry in request.knowledge_entries]
            if request.knowledge_entries
            else default["knowledge_entries"]
        )
        iterations = request.iterations or default["iterations"]
        simulations_count = request.simulations or 1

        # Initialize CKAgent
        agent = CKAgent()

        # Run simulations
        simulations = []
        for _ in range(simulations_count):
            simulation = await agent.run_simulation(topic, initial_entry, knowledge_entries, iterations)
            simulations.append(simulation)

        return {
            "simulations": simulations
        }

    except Exception as e:
        logger.error("Error in run_simulations: %s", str(e))
        return {"error": str(e)}



@router.post("/reorder", response_model=ReorderResponse)
async def reorder_knowledge(request: ReorderRequest):
    """Reorder knowledge entries based on the current history"""
    try:
        agent = CKAgent()
        reordered_entries = await agent.reorder_knowledge_entries(request.topic, request.ck_history)
        return {"reordered_knowledge": reordered_entries}
    except Exception as e:
        logger.error("Error in reorder_knowledge: %s", str(e))
        return {"error": str(e)}


@router.post("/create-concept", response_model=CreateConceptResponse)
async def create_concept(request: CreateConceptRequest):
    """Create a single concept by running one K->C operation."""
    try:
        agent = CKAgent()
        history = [entry.model_dump() for entry in request.ck_history]
        title, desc = agent.k_to_c(history, request.topic)

        next_concept_index = (
            sum(1 for entry in request.ck_history if entry.type.lower() == "concept") + 1
        )
        source_knowledge_ids = [
            entry.id for entry in request.ck_history if entry.type.lower() == "knowledge"
        ]

        response_payload = {
            "concept": {
                "id": f"C{next_concept_index}",
                "type": "concept",
                "title": title,
                "desc": desc,
                "operation_rationale": "Generated via single K->C (k_to_c) operation.",
            },
            "source_knowledge_ids": source_knowledge_ids,
        }
        logger.info("create_concept response: %s", response_payload)
        return response_payload
    except Exception as e:
        logger.error("Error in create_concept: %s", str(e))
        return {"error": str(e)}


@router.post("/create-knowledge", response_model=CreateKnowledgeResponse)
async def create_knowledge(request: CreateKnowledgeRequest):
    """Create a single knowledge entry by running one C->K operation."""
    try:
        agent = CKAgent()
        history = [entry.model_dump() for entry in request.ck_history]
        source_concept_id, title, desc = agent.create_knowledge(
            history,
            request.topic,
            focus_entry_id=request.focus_entry_id,
        )

        next_knowledge_index = (
            sum(1 for entry in request.ck_history if entry.type.lower() == "knowledge") + 1
        )

        response_payload = {
            "knowledge": {
                "id": f"K{next_knowledge_index}",
                "type": "knowledge",
                "title": title,
                "desc": desc,
                "operation_rationale": "Generated via single C->K (CreateKnowledge) operation.",
            },
            "source_concept_id": source_concept_id,
        }
        logger.info("create_knowledge response: %s", response_payload)
        return response_payload
    except Exception as e:
        logger.error("Error in create_knowledge: %s", str(e))
        return {"error": str(e)}


@router.post("/expand-concept", response_model=ExpandConceptResponse)
async def expand_concept(request: ExpandConceptRequest):
    """Expand a selected concept into 2-3 child concepts via C->C operation."""
    try:
        agent = CKAgent()
        history = [entry.model_dump() for entry in request.ck_history]
        parent_concept_id, expanded = agent.expand_concept(
            history,
            request.topic,
            focus_entry_id=request.focus_entry_id,
        )

        max_concept_index = 0
        for entry in request.ck_history:
            if entry.type.lower() != "concept":
                continue
            match = re.match(r"^C(\d+)$", entry.id.strip(), flags=re.IGNORECASE)
            if match:
                max_concept_index = max(max_concept_index, int(match.group(1)))

        concepts = []
        for i, concept in enumerate(expanded):
            concepts.append(
                {
                    "id": f"C{max_concept_index + i + 1}",
                    "type": "concept",
                    "title": concept["title"],
                    "desc": concept["desc"],
                    "operation_rationale": concept["operation_rationale"],
                }
            )

        response_payload = {
            "parent_concept_id": parent_concept_id,
            "concepts": concepts,
        }
        logger.info("expand_concept response: %s", response_payload)
        return response_payload
    except Exception as e:
        logger.error("Error in expand_concept: %s", str(e))
        return {"error": str(e)}


@router.post("/expand-knowledge", response_model=ExpandKnowledgeResponse)
async def expand_knowledge(request: ExpandKnowledgeRequest):
    """Expand a selected knowledge entry into 2-3 child knowledge entries via K->K operation."""
    try:
        agent = CKAgent()
        history = [entry.model_dump() for entry in request.ck_history]
        parent_knowledge_id, expanded = agent.expand_knowledge(
            history,
            request.topic,
            focus_entry_id=request.focus_entry_id,
        )

        max_knowledge_index = 0
        for entry in request.ck_history:
            if entry.type.lower() != "knowledge":
                continue
            match = re.match(r"^K(\d+)$", entry.id.strip(), flags=re.IGNORECASE)
            if match:
                max_knowledge_index = max(max_knowledge_index, int(match.group(1)))

        knowledges = []
        for i, knowledge in enumerate(expanded):
            knowledges.append(
                {
                    "id": f"K{max_knowledge_index + i + 1}",
                    "type": "knowledge",
                    "title": knowledge["title"],
                    "desc": knowledge["desc"],
                    "operation_rationale": knowledge["operation_rationale"],
                }
            )

        response_payload = {
            "parent_knowledge_id": parent_knowledge_id,
            "knowledges": knowledges,
        }
        logger.info("expand_knowledge response: %s", response_payload)
        return response_payload
    except Exception as e:
        logger.error("Error in expand_knowledge: %s", str(e))
        return {"error": str(e)}


@router.post("/decide-novel-concept", response_model=DecideNovelConceptResponse)
async def decide_novel_concept(request: DecideNovelConceptRequest):
    """Select the best concept using novelty/feasibility/usefulness/clarity."""
    try:
        agent = CKAgent()
        history = [entry.model_dump() for entry in request.ck_history]
        decision = agent.decide_novel_concept(history, request.topic)
        logger.info("decide_novel_concept response: %s", decision)
        return decision
    except Exception as e:
        logger.error("Error in decide_novel_concept: %s", str(e))
        return {"error": str(e)}


default = {
    "topic": "design a creative nail holder for when a person is hammering a nail.",
    "initial_entry": {
        "id": "C1",
        "type": "concept",
        "title": "Avanti nail holder",
        "desc": "A nail holder avoiding to hurt one's hand while hammering",
        "operation_rationale": "Not Applicable as this is the initial concept"
        },
    "knowledge_entries": [
        {
            "id": "K1",
            "type": "knowledge",
            "title": "Common user errors in hammering",
            "desc": "Users often miss the nail and accidentally strike their fingers, especially when starting the nail or when working in awkward positions.",
            "operation_rationale": "Not applicable as this is the initial knowledge base"
        },
        {
            "id": "K2",
            "type": "knowledge",
            "title": "Variety of nail sizes and shapes",
            "desc": "Nails come in different lengths, thicknesses, and head sizes. A nail holder must accommodate a range of common nails without being too complex or bulky.",
            "operation_rationale": "Not applicable as this is the initial knowledge base"
        },
        {
            "id": "K3",
            "type": "knowledge",
            "title": "Material considerations",
            "desc": "Material should be durable enough to withstand occasional hammer strikes, but also light, affordable, and preferably non-slip for easy handling.",
            "operation_rationale": "Not applicable as this is the initial knowledge base"
        },
        {
            "id": "K4",
            "type": "knowledge",
            "title": "Ergonomic and usability design",
            "desc": "The holder should be easy to grip, ideally usable by either left- or right-handed users, and not require excessive dexterity or strength.",
            "operation_rationale": "Not applicable as this is the initial knowledge base"
        },
        {
            "id": "K5",
            "type": "knowledge",
            "title": "Environmental and practical factors",
            "desc": "The holder may be used in indoor and outdoor environments, possibly on uneven surfaces or in poor lighting.",
            "operation_rationale": "Not applicable as this is the initial knowledge base"
        }
    ],
    "iterations": 1}
