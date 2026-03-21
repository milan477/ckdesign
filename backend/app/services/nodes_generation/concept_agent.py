import json
import re

from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine


class ConceptAgent:
    """Concept-side CK operations."""

    _SINGLE_FIELD_PATTERN = re.compile(
        r"^\s*TITLE:\s*(?P<title>.+?)\s*$"
        r"(?:\r?\n)+\s*DESC:\s*(?P<desc>.+?)\s*$"
        r"(?:\r?\n)+\s*RATIONALE:\s*(?P<rationale>.+?)\s*$",
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    _ITEM_BLOCK_PATTERN = re.compile(
        r"ITEM\s+(?P<index>\d+)\s*"
        r"(?:\r?\n)+\s*TITLE:\s*(?P<title>[^\r\n]+)\s*"
        r"(?:\r?\n)+\s*DESC:\s*(?P<desc>[^\r\n]+)\s*"
        r"(?:\r?\n)+\s*RATIONALE:\s*(?P<rationale>[^\r\n]+)",
        re.IGNORECASE,
    )

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

    @staticmethod
    def _normalize_field(value):
        return re.sub(r"\s+", " ", str(value or "")).strip()

    @classmethod
    def _parse_single_entry(cls, content, fallback_rationale):
        match = cls._SINGLE_FIELD_PATTERN.search(content or "")
        if not match:
            raise ValueError("Failed to parse single-entry model response.")

        title = cls._normalize_field(match.group("title"))
        desc = cls._normalize_field(match.group("desc"))
        rationale = cls._normalize_field(match.group("rationale"))

        if not title or not desc:
            raise ValueError("Parsed single-entry response is missing title or desc.")

        return {
            "title": title,
            "desc": desc,
            "operation_rationale": rationale or fallback_rationale,
        }

    @classmethod
    def _parse_item_entries(cls, content, desired_count, fallback_rationale):
        matches = list(cls._ITEM_BLOCK_PATTERN.finditer(content or ""))
        if len(matches) < desired_count:
            raise ValueError(
                f"Expected at least {desired_count} item blocks, but got {len(matches)}.",
            )

        entries = []
        for expected_index, match in enumerate(matches[:desired_count], start=1):
            item_index = int(match.group("index"))
            if item_index != expected_index:
                raise ValueError(
                    f"Expected ITEM {expected_index}, but got ITEM {item_index}.",
                )

            title = cls._normalize_field(match.group("title"))
            desc = cls._normalize_field(match.group("desc"))
            rationale = cls._normalize_field(match.group("rationale"))
            if not title or not desc:
                raise ValueError(
                    f"ITEM {expected_index} is missing title or desc.",
                )

            entries.append(
                {
                    "title": title,
                    "desc": desc,
                    "operation_rationale": rationale or fallback_rationale,
                }
            )

        return entries

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

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_k_to_c}
            ],
            temperature=0,
        )

        parsed = self._parse_single_entry(
            response.choices[0].message.content,
            "Generated via single K->C (CreateConcept) operation.",
        )

        return (
            focus_knowledge.get("id", ""),
            parsed["title"],
            parsed["desc"],
            parsed["operation_rationale"],
        )

    def ExpandConcept(self, ck_history, topic, focus_entry_id=None, target_count=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        concept_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "concept"
        ]
        if not concept_entries:
            raise ValueError("ExpandConcept requires at least one concept in ck_history.")

        if isinstance(target_count, int):
            desired_count = target_count
        else:
            desired_count = 2
        desired_count = max(1, min(desired_count, 5))

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
            target_count=desired_count,
        )

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_expand_concept},
            ],
            temperature=0,
        )

        concepts = self._parse_item_entries(
            response.choices[0].message.content,
            desired_count,
            "Generated by ExpandConcept (C-->C) operation.",
        )

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
