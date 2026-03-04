import logging

from fastapi import APIRouter
from backend.app.schemas.node import CKEntry, NodeGenerateRequest, NodeOut, SimulationRequest, SimulationResponse, ReorderRequest, ReorderResponse, CreateConceptRequest, CreateConceptResponse
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


@router.post("/reorder", response_model=ReorderResponse)
async def reorder_knowledge(request: ReorderRequest):
    """Reorder knowledge entries based on the current history"""
    agent = CKAgent()
    reordered_entries = await agent.reorder_knowledge_entries(request.topic, request.ck_history)
    return {"reordered_knowledge": reordered_entries}


@router.post("/create-concept", response_model=CreateConceptResponse)
async def create_concept(request: CreateConceptRequest):
    """Create a single concept by running one K->C operation."""
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
