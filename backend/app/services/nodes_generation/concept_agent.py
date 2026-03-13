import json

from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine


class ConceptAgent:
    """Concept-side CK operations."""

    def __init__(self, llm_model: str = "gpt-4.1", ai_client: OpenAIClient = None):
        self.ai = ai_client or OpenAIClient(llm_model=llm_model)
        self.client = self.ai.client
        self.llm_model = self.ai.llm_model

    @staticmethod
    def _entry_to_dict(entry):
        if isinstance(entry, dict):
            return entry
        if hasattr(entry, "model_dump"):
            return entry.model_dump()
        if hasattr(entry, "dict"):
            return entry.dict()
        return {
            "id": getattr(entry, "id", ""),
            "type": getattr(entry, "type", ""),
            "title": getattr(entry, "title", ""),
            "desc": getattr(entry, "desc", ""),
            "operation_rationale": getattr(entry, "operation_rationale", ""),
        }

    def CreateConcept(self, ck_history, topic, focus_entry_id=None):
        """Knowledge-to-Concept generation from a selected knowledge entry."""
        history = [self._entry_to_dict(entry) for entry in ck_history]
        knowledge_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "knowledge"
        ]
        if not knowledge_entries:
            raise ValueError("CreateConcept requires at least one knowledge entry in ck_history.")

        focus_knowledge = None
        if focus_entry_id:
            focus_knowledge = next(
                (
                    entry
                    for entry in knowledge_entries
                    if str(entry.get("id", "")).strip() == str(focus_entry_id).strip()
                ),
                None,
            )
        if focus_knowledge is None:
            focus_knowledge = knowledge_entries[-1]

        prompt_k_to_c = CKPromptEngine.create_concept_from_knowledge(
            topic,
            json.dumps(history, indent=2),
            json.dumps(focus_knowledge, indent=2),
        )

        title_prmpt = CKPromptEngine.TITLE_TRANSFORM
        desc_prmpt = CKPromptEngine.DESC_TRANSFORM

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_c}
            ],
            temperature=1
        )

        response_title = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_c},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": title_prmpt}
            ],
            temperature=0
        )

        response_desc = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_c},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": desc_prmpt}
            ],
            temperature=0
        )

        final_title = response_title.choices[0].message.content
        final_desc = response_desc.choices[0].message.content

        return focus_knowledge.get("id", ""), final_title, final_desc

    def ExpandConcept(self, ck_history, topic, focus_entry_id=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        concept_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "concept"
        ]
        if not concept_entries:
            raise ValueError("ExpandConcept requires at least one concept in ck_history.")

        focus_concept = None
        if focus_entry_id:
            focus_concept = next(
                (
                    entry
                    for entry in concept_entries
                    if str(entry.get("id", "")).strip() == str(focus_entry_id).strip()
                ),
                None,
            )
        if focus_concept is None:
            focus_concept = concept_entries[-1]

        prompt_expand_concept = CKPromptEngine.expand_concept(
            topic,
            json.dumps(history, indent=2),
            json.dumps(focus_concept, indent=2),
        )

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_expand_concept},
            ],
            temperature=1,
            response_format={"type": "json_object"},
        )

        payload = json.loads(response.choices[0].message.content or "{}")
        raw_concepts = payload.get("concepts", [])
        if not isinstance(raw_concepts, list):
            raise ValueError("ExpandConcept: invalid response, expected 'concepts' array.")

        concepts = []
        for entry in raw_concepts:
            if not isinstance(entry, dict):
                continue
            title = str(entry.get("title", "")).strip()
            desc = str(entry.get("desc", "")).strip()
            if not title or not desc:
                continue
            rationale = str(entry.get("operation_rationale", "")).strip()
            concepts.append(
                {
                    "title": title,
                    "desc": desc,
                    "operation_rationale": rationale
                    or "Generated by ExpandConcept (C-->C) operation.",
                }
            )
            if len(concepts) == 3:
                break

        if len(concepts) < 2:
            raise ValueError("ExpandConcept expected 2-3 concepts, but got fewer.")

        return focus_concept.get("id", ""), concepts

    def RenderConcept(self, *args, **kwargs):
        raise NotImplementedError("RenderConcept is not implemented yet.")

    def DecideNovelConcept(self, ck_history, topic):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        concept_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "concept"
        ]
        if not concept_entries:
            raise ValueError("DecideNovelConcept requires at least one concept in ck_history.")

        prompt = CKPromptEngine.decide_novel_concept(topic, json.dumps(history, indent=2))

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )

        payload = json.loads(response.choices[0].message.content or "{}")
        selected_concept_id = str(payload.get("selected_concept_id", "")).strip()
        rationale = str(payload.get("rationale", "")).strip()
        raw_scores = payload.get("scores", {})

        concept_id_set = {str(entry.get("id", "")).strip() for entry in concept_entries}
        if selected_concept_id not in concept_id_set:
            selected_concept_id = str(concept_entries[-1].get("id", "")).strip()

        def _score_value(key):
            if isinstance(raw_scores, dict):
                value = raw_scores.get(key)
                if isinstance(value, (int, float)):
                    return float(value)
            return 0.0

        scores = {
            "novelty": _score_value("novelty"),
            "feasibility": _score_value("feasibility"),
            "usefulness": _score_value("usefulness"),
            "clarity": _score_value("clarity"),
        }

        if not rationale:
            rationale = (
                "Selected as the strongest overall concept across novelty, "
                "feasibility, usefulness, and clarity."
            )

        return {
            "selected_concept_id": selected_concept_id,
            "rationale": rationale,
            "scores": scores,
        }
