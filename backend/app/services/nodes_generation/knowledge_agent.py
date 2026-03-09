import json

from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine


class KnowledgeAgent:
    """Knowledge-side CK operations."""

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

    def CreateKnowledge(self, ck_history, topic, focus_entry_id=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        concept_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "concept"
        ]
        if not concept_entries:
            raise ValueError("CreateKnowledge requires at least one concept in ck_history.")

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

        prompt = CKPromptEngine.create_knowledge_from_concept(
            topic,
            json.dumps(history, indent=2),
            json.dumps(focus_concept, indent=2),
        )

        title_prmpt = CKPromptEngine.TITLE_TRANSFORM
        desc_prmpt = CKPromptEngine.DESC_TRANSFORM

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
            ],
            temperature=1,
        )

        response_title = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": title_prmpt},
            ],
            temperature=0,
        )

        response_desc = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": response.choices[0].message.content},
                {"role": "user", "content": desc_prmpt},
            ],
            temperature=0,
        )

        final_title = response_title.choices[0].message.content
        final_desc = response_desc.choices[0].message.content

        return focus_concept.get("id", ""), final_title, final_desc

    def ExpandKnowledge(self, ck_history, topic, focus_entry_id=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        knowledge_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "knowledge"
        ]
        if not knowledge_entries:
            raise ValueError("ExpandKnowledge requires at least one knowledge entry in ck_history.")

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

        prompt_expand_knowledge = CKPromptEngine.expand_knowledge(
            topic,
            json.dumps(history, indent=2),
            json.dumps(focus_knowledge, indent=2),
        )

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_expand_knowledge},
            ],
            temperature=1,
            response_format={"type": "json_object"},
        )

        payload = json.loads(response.choices[0].message.content or "{}")
        raw_knowledges = payload.get("knowledges", [])
        if not isinstance(raw_knowledges, list):
            raise ValueError("ExpandKnowledge: invalid response, expected 'knowledges' array.")

        knowledges = []
        for entry in raw_knowledges:
            if not isinstance(entry, dict):
                continue
            title = str(entry.get("title", "")).strip()
            desc = str(entry.get("desc", "")).strip()
            if not title or not desc:
                continue
            rationale = str(entry.get("operation_rationale", "")).strip()
            knowledges.append(
                {
                    "title": title,
                    "desc": desc,
                    "operation_rationale": rationale
                    or "Generated by ExpandKnowledge (K-->K) operation.",
                }
            )
            if len(knowledges) == 3:
                break

        if len(knowledges) < 2:
            raise ValueError("ExpandKnowledge expected 2-3 knowledge entries, but got fewer.")

        return focus_knowledge.get("id", ""), knowledges

    def ReorderKnowledge(self, *args, **kwargs):
        raise NotImplementedError("ReorderKnowledge is not implemented yet.")

    def ValidateConcept(self, *args, **kwargs):
        raise NotImplementedError("ValidateConcept is not implemented yet.")
