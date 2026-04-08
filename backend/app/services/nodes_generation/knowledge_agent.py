import json
import re

from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine


class KnowledgeAgent:
    """Knowledge-side CK operations."""

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
    _VALIDATION_PATTERN = re.compile(
        r"^\s*VERDICT:\s*(?P<verdict>VALID|INVALID)\s*$"
        r"(?:\r?\n)+\s*RATIONALE:\s*(?P<rationale>.+?)\s*$",
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
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

    @classmethod
    def _parse_validation_result(cls, content):
        match = cls._VALIDATION_PATTERN.search(content or "")
        if not match:
            raise ValueError("Failed to parse validation model response.")

        verdict = cls._normalize_field(match.group("verdict")).upper()
        rationale = cls._normalize_field(match.group("rationale"))
        if verdict not in {"VALID", "INVALID"}:
            raise ValueError(f"Unsupported validation verdict: {verdict}")
        if not rationale:
            raise ValueError("Validation response is missing rationale.")

        return {
            "is_valid": verdict == "VALID",
            "rationale": rationale,
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

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )

        parsed = self._parse_single_entry(
            response.choices[0].message.content,
            "Generated via single C->K (CreateKnowledge) operation.",
        )

        return (
            focus_concept.get("id", ""),
            parsed["title"],
            parsed["desc"],
            parsed["operation_rationale"],
        )

    def ExpandKnowledge(self, ck_history, topic, focus_entry_id=None, target_count=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        knowledge_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "knowledge"
        ]
        if not knowledge_entries:
            raise ValueError("ExpandKnowledge requires at least one knowledge entry in ck_history.")

        if isinstance(target_count, int):
            desired_count = target_count
        else:
            desired_count = 2
        desired_count = max(1, min(desired_count, 5))

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
            target_count=desired_count,
        )

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt_expand_knowledge},
            ],
            temperature=0,
        )

        knowledges = self._parse_item_entries(
            response.choices[0].message.content,
            desired_count,
            "Generated by ExpandKnowledge (K-->K) operation.",
        )

        return focus_knowledge.get("id", ""), knowledges

    def ReorderKnowledge(self, *args, **kwargs):
        raise NotImplementedError("ReorderKnowledge is not implemented yet.")

    def ValidateConcept(self, ck_history, topic, focus_entry_id=None):
        history = [self._entry_to_dict(entry) for entry in ck_history]
        concept_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "concept"
        ]
        knowledge_entries = [
            entry for entry in history if str(entry.get("type", "")).lower() == "knowledge"
        ]

        if not concept_entries:
            raise ValueError("ValidateConcept requires at least one concept in ck_history.")
        if not knowledge_entries:
            raise ValueError("ValidateConcept requires at least one knowledge entry in ck_history.")

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

        prompt = CKPromptEngine.validate_concept(
            topic,
            json.dumps(history, indent=2),
            json.dumps(focus_concept, indent=2),
        )

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )

        parsed = self._parse_validation_result(response.choices[0].message.content)
        return {
            "concept_id": focus_concept.get("id", ""),
            "is_valid": parsed["is_valid"],
            "rationale": parsed["rationale"],
        }

    _PLACEMENT_PATTERN = re.compile(
        r"^\s*CONNECTED_TO:\s*(?P<connected>.+?)\s*$"
        r"(?:\r?\n)+"
        r"\s*RATIONALE:\s*(?P<rationale>.+?)\s*$",
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )

    def PlaceKnowledge(self, ck_history, topic: str, new_knowledge_title: str, new_knowledge_desc: str):
        """Decide which existing knowledge nodes the new knowledge connects to, if any."""
        knowledge_entries = [
            self._entry_to_dict(e)
            for e in ck_history
            if self._entry_to_dict(e).get("type", "").lower() == "knowledge"
        ]
        valid_ids = {e["id"] for e in knowledge_entries}

        existing_json = json.dumps(
            [{"id": e["id"], "title": e["title"], "desc": e["desc"]} for e in knowledge_entries],
            indent=2,
        )
        new_json = json.dumps({"title": new_knowledge_title, "desc": new_knowledge_desc}, indent=2)

        prompt = CKPromptEngine.place_knowledge_in_archipelago(topic, existing_json, new_json)

        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=[
                {"role": "system", "content": CKPromptEngine.SYSTEM_CK_EXPERT},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )

        content = response.choices[0].message.content or ""
        match = self._PLACEMENT_PATTERN.search(content)

        if not match:
            return [], "Could not determine placement — treating as a new island."

        connected_raw = match.group("connected").strip()
        rationale = self._normalize_field(match.group("rationale"))

        if connected_raw.lower() == "none":
            connected_ids = []
        else:
            connected_ids = [
                cid.strip()
                for cid in connected_raw.split(",")
                if cid.strip() in valid_ids
            ]

        return connected_ids, rationale
