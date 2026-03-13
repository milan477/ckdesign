from openai import OpenAI
import json
from backend.app.services.nodes_generation.concept_agent import ConceptAgent
from backend.app.services.nodes_generation.knowledge_agent import KnowledgeAgent
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine
from backend.app.services.nodes_generation.tool_engine import CKToolEngine
from backend.app.services.ai.ai import OpenAIClient

from backend.app.services.nodes_specification.CK_nodes import CKElement, CKType, CKNode


async def generate_nodes(description: str):
    return {"node_id": "1", "type": "concept", "description": description}


class CKAgent:
    def __init__(self, llm_model: str = "gpt-4.1"):
        self.ai = OpenAIClient(llm_model=llm_model)

        self.client = self.ai.client
        self.llm_model = self.ai.llm_model
        self.concept_agent = ConceptAgent(llm_model=self.llm_model, ai_client=self.ai)
        self.knowledge_agent = KnowledgeAgent(llm_model=self.llm_model, ai_client=self.ai)

    @staticmethod
    def _normalize_ck_type(type_value):
        """Normalize a CK type from enum/string inputs."""
        if isinstance(type_value, CKType):
            return type_value
        if isinstance(type_value, str):
            normalized = type_value.strip().lower()
            if normalized == "knowledge":
                return CKType.KNOWLEDGE
            if normalized == "concept":
                return CKType.CONCEPT
        raise ValueError(f"Unsupported CK type value: {type_value}")

    def _coerce_ck_element(self, entry):
        """Coerce dict/pydantic inputs to CKElement."""
        if isinstance(entry, CKElement):
            return entry

        if hasattr(entry, "model_dump"):
            entry = entry.model_dump()
        elif hasattr(entry, "dict"):
            entry = entry.dict()

        if not isinstance(entry, dict):
            raise TypeError(f"Unsupported CK entry type: {type(entry)}")

        return CKElement(
            id=entry.get("id", ""),
            type=self._normalize_ck_type(entry.get("type")),
            title=entry.get("title", ""),
            desc=entry.get("desc", ""),
            operation_rationale=entry.get("operation_rationale", "")
        )

    def _get_entry_type(self, entry):
        if isinstance(entry, CKElement):
            return entry.type
        if hasattr(entry, "type"):
            return self._normalize_ck_type(entry.type)
        if isinstance(entry, dict):
            return self._normalize_ck_type(entry.get("type"))
        raise TypeError(f"Unsupported CK entry type: {type(entry)}")

    def givenC_determine_c_or_k(self, ck_history, topic):
        """Determine whether to go from Concept to Concept or Concept to Knowledge"""

        prompt_1 = CKPromptEngine.choose_concept_to_concept_or_knowledge(topic, ck_history)
        sys_prompt = CKPromptEngine.SYSTEM_CK_EXPERT

        tools = CKToolEngine.choose_concept_or_knowledge_tool()

        response = self.client.responses.create(
            model="gpt-5",
            input=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_1},
            ],
            text={"verbosity": "low"},
            reasoning={"effort": "low"},
            tools=tools,
            tool_choice={"type": "function", "name": "choose_K_or_C"}
        )

        concept_or_knowledge = json.loads(response.output[1].arguments)["decision"]

        prompt_2 = CKPromptEngine.explain_choice_concept_to_concept_or_knowledge(topic, ck_history, concept_or_knowledge)

        response_1 = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_2}
            ],
            temperature=0
        )

        prompt_rationale = CKPromptEngine.RATIONALE_TRANSFORM

        response_2 = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_2},
                {"role": "assistant", "content": response_1.choices[0].message.content},
                {"role": "user", "content": prompt_rationale}
            ],
            temperature=0
        )

        rationale = response_2.choices[0].message.content

        if concept_or_knowledge == "Concept":
            concept_or_knowledge = CKType.CONCEPT
        else:
            concept_or_knowledge = CKType.KNOWLEDGE
        return concept_or_knowledge, rationale

    def givenK_determine_c_or_k(self, ck_history, topic):
        """Determine whether to go from Knowledge to Concept or Knowledge to Knowledge"""
        prompt_1 = CKPromptEngine.choose_knowledge_to_concept_or_knowledge(topic, ck_history)

        sys_prompt = CKPromptEngine.SYSTEM_CK_EXPERT

        tools = CKToolEngine.choose_concept_or_knowledge_tool()

        response = self.client.responses.create(
            model="gpt-5",
            input=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_1},
            ],
            text={"verbosity": "low"},
            reasoning={"effort": "low"},
            tools=tools,
            tool_choice={"type": "function", "name": "choose_K_or_C"}
        )

        concept_or_knowledge = json.loads(response.output[1].arguments)["decision"]

        prompt_2 = CKPromptEngine.explain_choice_knowledge_to_concept_or_knowledge(topic, ck_history, concept_or_knowledge)

        response_1 = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_2}
            ],
            temperature=0
        )

        prompt_rationale = CKPromptEngine.RATIONALE_TRANSFORM

        response_2 = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt_2},
                {"role": "assistant", "content": response_1.choices[0].message.content},
                {"role": "user", "content": prompt_rationale}
            ],
            temperature=0
        )

        rationale = response_2.choices[0].message.content

        if concept_or_knowledge == "Concept":
            concept_or_knowledge = CKType.CONCEPT
        else:
            concept_or_knowledge = CKType.KNOWLEDGE
        return concept_or_knowledge, rationale

    def c_to_k(self, ck_history, topic):
        """Concept to Knowledge operation"""
        prompt_c_to_k = CKPromptEngine.concept_to_knowledge(topic, ck_history)

        title_prmpt = CKPromptEngine.TITLE_TRANSFORM
        desc_prmpt = CKPromptEngine.DESC_TRANSFORM

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_k}
            ],
            temperature=1
        )

        response_title = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_k},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": title_prmpt}
            ],
            temperature=0
        )

        response_desc = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_k},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": desc_prmpt}
            ],
            temperature=0
        )

        final_title = response_title.choices[0].message.content
        final_desc = response_desc.choices[0].message.content

        return final_title, final_desc

    def c_to_c(self, ck_history, topic):
        """Concept to Concept operation"""
        prompt_c_to_c = CKPromptEngine.concept_to_concept(topic, ck_history)

        title_prmpt = CKPromptEngine.TITLE_TRANSFORM
        desc_prmpt = CKPromptEngine.DESC_TRANSFORM

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_c}
            ],
            temperature=1
        )

        response_title = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_c},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": title_prmpt}
            ],
            temperature=0
        )

        response_desc = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_c_to_c},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": desc_prmpt}
            ],
            temperature=0
        )

        final_title = response_title.choices[0].message.content
        final_desc = response_desc.choices[0].message.content

        return final_title, final_desc

    def k_to_k(self, ck_history, topic):
        """Knowledge to Knowledge operation"""
        prompt_k_to_k = CKPromptEngine.knowledge_to_knowledge(topic, ck_history)

        title_prmpt = CKPromptEngine.TITLE_TRANSFORM
        desc_prmpt = CKPromptEngine.DESC_TRANSFORM

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_k}
            ],
            temperature=1
        )

        response_title = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_k},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": title_prmpt}
            ],
            temperature=0
        )

        response_desc = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_k},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": desc_prmpt}
            ],
            temperature=0
        )

        final_title = response_title.choices[0].message.content
        final_desc = response_desc.choices[0].message.content

        return final_title, final_desc

    def k_to_c(self, ck_history, topic, focus_entry_id=None):
        """Compatibility wrapper. Delegates to ConceptAgent.CreateConcept."""
        return self.concept_agent.CreateConcept(
            ck_history,
            topic,
            focus_entry_id=focus_entry_id,
        )

    def expand_concept(self, ck_history, topic, focus_entry_id=None, target_count=None):
        """Expand a concept into requested child concepts."""
        return self.concept_agent.ExpandConcept(
            ck_history,
            topic,
            focus_entry_id=focus_entry_id,
            target_count=target_count,
        )

    def decide_novel_concept(self, ck_history, topic):
        """Choose the best concept using novelty/feasibility/usefulness/clarity."""
        return self.concept_agent.DecideNovelConcept(ck_history, topic)

    def create_knowledge(self, ck_history, topic, focus_entry_id=None):
        """Create one knowledge entry from a selected concept."""
        return self.knowledge_agent.CreateKnowledge(
            ck_history,
            topic,
            focus_entry_id=focus_entry_id,
        )

    def expand_knowledge(self, ck_history, topic, focus_entry_id=None, target_count=None):
        """Expand one knowledge entry into requested child knowledge entries."""
        return self.knowledge_agent.ExpandKnowledge(
            ck_history,
            topic,
            focus_entry_id=focus_entry_id,
            target_count=target_count,
        )

    def get_k(self, topic):
        """Initialize knowledge entries"""

        sys_prompt = CKPromptEngine.SYSTEM_CK_EXPERT

        prompt = CKPromptEngine.initialize_knowledge_entries(topic)

        response = self.client.responses.create(
            model="gpt-5",
            input=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt},
            ],
            text={"verbosity": "low"},
            reasoning={"effort": "medium"},
        )

        entries = json.loads(response.output[1].content[0].text)['knowledge_entries']

        knowledge_entries = [
            CKElement(
                id="K0",
                type=CKType.KNOWLEDGE,
                title=entry,
                desc="Not yet implemented",
                operation_rationale="Initial knowledge base"
            )
            for i, entry in enumerate(entries)
        ]

        return knowledge_entries

    def get_filtered_history(self, ck_history, include_concepts=True):
        """Filter history to include or exclude concepts"""
        if include_concepts:
            return ck_history
        else:
            # Keep only Knowledge-type entries
            return [entry for entry in ck_history if self._get_entry_type(entry) == CKType.KNOWLEDGE]

    async def reorder_knowledge_entries(self, topic: str, ck_history: list):
        """Reorder knowledge entries based on the topic and history"""
        # Convert ck_history to string for prompt
        history_str = json.dumps([entry.dict() if hasattr(entry, 'dict') else entry for entry in ck_history], indent=2)

        prompt_reorder_knowledge_entries = CKPromptEngine.reorder_knowledge_entries(topic, history_str)

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_reorder_knowledge_entries}
            ],
            temperature=0.5,
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content

        try:
            data = json.loads(content)
            entries = data.get("knowledge_entries", [])

            # Convert to list of dicts (compatible with CKEntry)
            result = []
            for e in entries:
                result.append({
                    "id": e.get("id"),
                    "type": "knowledge",
                    "title": e.get("title"),
                    "desc": e.get("desc"),
                    "operation_rationale": e.get("reordering_rationale", "Reordered based on K-Space optimization")
                })
            return result

        except json.JSONDecodeError:
            print("Failed to parse reorder response")
            # Fallback: return original knowledge entries
            return [entry.dict() for entry in ck_history if entry.type == 'knowledge']

    async def run_simulation(self, topic: str, initial_entry: dict, knowledge_entries: list, iterations: int = 2):
        """Run a single simulation with the given parameters"""
        CK_history = []

        # Add initial entry
        if initial_entry:
            CK_history.append(self._coerce_ck_element(initial_entry))

        # Add knowledge entries
        if knowledge_entries:
            for k in knowledge_entries:
                CK_history.append(self._coerce_ck_element(k))
        else:
            knowledge_entries_generated = self.get_k(topic)
            for k in knowledge_entries_generated:
                CK_history.append(self._coerce_ck_element(k))

        for iteration in range(iterations):
            current_type = self._get_entry_type(CK_history[-1])

            filtered_history = self.get_filtered_history(CK_history, include_concepts=True) # TODO

            # Determine next operation
            if current_type == CKType.KNOWLEDGE:
                future_type, reasoning = self.givenK_determine_c_or_k(CK_history, topic)
            else:
                future_type, reasoning = self.givenC_determine_c_or_k(CK_history, topic)

            # Execute the appropriate operation
            if current_type == CKType.CONCEPT and future_type == CKType.CONCEPT:
                title, desc = self.c_to_c(filtered_history, topic)
                future_id = "C" + str(iteration + 1)
            elif current_type == CKType.CONCEPT and future_type == CKType.KNOWLEDGE:
                title, desc = self.c_to_k(filtered_history, topic)
                future_id = "K" + str(iteration + 1)
            elif current_type == CKType.KNOWLEDGE and future_type == CKType.KNOWLEDGE:
                title, desc = self.k_to_k(filtered_history, topic)
                future_id = "K" + str(iteration + 1)
            elif current_type == CKType.KNOWLEDGE and future_type == CKType.CONCEPT:
                _, title, desc = self.k_to_c(filtered_history, topic)
                future_id = "C" + str(iteration + 1)
            else:
                title, desc = self.c_to_c(filtered_history, topic)
                future_id = "C" + str(iteration + 1)

            next_entry = CKElement(
                id=future_id,
                type=future_type,
                title=title,
                desc=desc,
                operation_rationale=reasoning
            )

            CK_history.append(next_entry)


        # convert CK_history to list of dicts for output
        CK_history = [
            entry.to_dict() for entry in CK_history]

        return CK_history


# TODO: generate a tree structure rather than a flat list for CK history
# TODO: batch processing of simulations (reveal bit by bit)
