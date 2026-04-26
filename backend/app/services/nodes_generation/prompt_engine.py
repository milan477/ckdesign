import json

class PromptEngine:
    pass

class CKPromptEngine(PromptEngine):
    # System prompts
    SYSTEM_CK_EXPERT = "You are an expert in C-K Theory."

    # Common prompts
    TITLE_TRANSFORM = "Transform your response into a single title adhering strictly to the following format."
    DESC_TRANSFORM = "Transform your response into a 2-3 sentence description of the proposed concept adhering strictly to the following format."
    RATIONALE_TRANSFORM = "Transform your response into a 2-3 sentence summarizing the rationale."

    @staticmethod
    def choose_concept_to_concept_or_knowledge(topic: str, ck_history: str) -> str:
        """Determine whether to go from Concept to Concept or Concept to Knowledge"""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}
Analyze the most recent item in the CK history shown below.
{ck_history}
Context:
Your task is to decide whether the next step should be to generate a new concept (C-->C) or to expand the knowledge space (C-->K) based on the current state of the concept and knowledge space.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic.
Concept Space (C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to evaluate whether to go from concept to concept or concept to knowledge.
- C-->C (Concept Expansion): Use this if the concept still holds significant ambiguity or unexplored potential that cannot yet be resolved or validated with the existing knowledge base. This path is chosen when further ideation or exploration is necessary to refine the concept or when the concept introduces novel elements that challenge existing knowledge boundaries. Focus on exploring whether there exists truly novel propositions that can transform or extend the knowledge space.
- C-->K (Concept to Knowledge): Choose this path when the concept has been sufficiently refined and aligns with the existing knowledge base, allowing it to be tested, validated, or implemented. This transition is appropriate when the concept can be logically integrated into the knowledge space, resolving its ambiguity and proving its feasibility or truthfulness within the current understanding. Note, the integration of new knowledge is not just about validation but also about whether the concept can enrich the knowledge space. If it meets some of these criteria, it is time to go to K.
Instructions:
1. Analyze the current concept and the existing knowledge base.
2. Decide whether to apply C-->C or C-->K, using C-K theory logic. Reply with concept for C-->C or knowledge for C-->K
3. Respond with:
Decision: [Concept or Knowledge]
        """

    @staticmethod
    def explain_choice_concept_to_concept_or_knowledge(topic: str, ck_history: str, concept_or_knowledge: str) -> str:
        """Explain the rationale for choosing C-->C or C-->K"""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}
Analyze the most recent item in the CK history shown below.
{ck_history}
Context:
Your task is to decide whether the next step should be to generate a new concept (C-->C) or to expand the knowledge space (C-->K) based on the current state of the concept and knowledge space.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic.
Concept Space (C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to evaluate whether to go from concept to concept or concept to knowledge.
- C-->C (Concept Expansion): Use this if the concept still holds significant ambiguity or unexplored potential that cannot yet be resolved or validated with the existing knowledge base. This path is chosen when further ideation or exploration is necessary to refine the concept or when the concept introduces novel elements that challenge existing knowledge boundaries. Focus on exploring whether there exists truly novel propositions that can transform or extend the knowledge space.
- C-->K (Concept to Knowledge): Choose this path when the concept has been sufficiently refined and aligns with the existing knowledge base, allowing it to be tested, validated, or implemented. This transition is appropriate when the concept can be logically integrated into the knowledge space, resolving its ambiguity and proving its feasibility or truthfulness within the current understanding. Note, the integration of new knowledge is not just about validation but also about whether the concept can enrich the knowledge space. If it meets some of these criteria, it is time to go to K.
Based on prior analysis, the choice has already been made to go from concept to {concept_or_knowledge}.
Please now generate a detailed rationale for why conducting a concept to {concept_or_knowledge} operation is the correct step based on the distinction between concept expansion and concept to knowledge.
        """

    @staticmethod
    def choose_knowledge_to_concept_or_knowledge(topic: str, ck_history: str) -> str:
        """Determine whether to go from Knowledge to Concept or Knowledge to Knowledge"""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}
Analyze the most recent item in the CK history shown below.
{ck_history}
Context:
Your task is to decide whether the next step should be to generate a new concept (K-->C) or to expand the knowledge space (K-->K) based on the current state of the concept and knowledge space.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic.
Concept Space (C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to evaluate whether to go from knowledge to concept or knowledge to knowledge.
- K-->C (Knowledge to Concept): Used when existing knowledge suggests new concepts or when you suspect new insights from K can lead to the generation of new concepts.
- K-->K (Knowledge Expansion): Used to expand the knowledge space by adding new validated propositions or insights.
Instructions:
1. Analyze the current concept and the existing knowledge base.
2. Decide whether to apply K-->C or K-->K, using C-K theory logic. Reply with concept for K-->C or knowledge for K-->K.
3. Respond with:
Decision: [Concept or Knowledge]
        """

    @staticmethod
    def explain_choice_knowledge_to_concept_or_knowledge(topic: str, ck_history: str, concept_or_knowledge: str) -> str:
        """Explain the rationale for choosing K-->C or K-->K"""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}
Analyze the most recent item in the CK history shown below.
{ck_history}
Context:
Your task is to decide whether the next step should be to generate a new concept (K-->C) or to expand the knowledge space (K-->K) based on the current state of the concept and knowledge space.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic.
Concept Space (C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to evaluate whether to go from knowledge to concept or knowledge to knowledge.
- K-->C (Knowledge to Concept): Used when existing knowledge suggests new concepts or when you suspect new insights from K can lead to the generation of new concepts.
- K-->K (Knowledge Expansion): Used to expand the knowledge space by adding new validated propositions or insights.
Based on prior analysis, the choice has already been made to go from knowledge to {concept_or_knowledge}.
Please now generate a detailed rationale for why conducting a knowledge to {concept_or_knowledge} operation is the correct step based on the distinction between knowledge expansion and knowledge to concept.
        """

    @staticmethod
    def concept_to_knowledge(topic: str, ck_history: str) -> str:
        """C-->K operation prompt"""
        return f"""
You are an AI simulation with the goal of doing a C-->K operation from the C-K Theory.
The topic you are working on is to {topic} You are highly knowledgable in this topic area.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic. You as an AI are permitted to determine what is considered the "knowledge space". Please base your "knowledge space" on existing industry and academic standards.
Concept Space (also C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to conduct a C-->K operation. A C-->K operation in C-K theory transforms a concept (an idea not yet validated as true or false) into knowledge by evaluating it against the current knowledge space. This involves testing the concept's propositions to determine if they can be accepted as true or false within existing knowledge. If the concept is validated or refuted through this process, it becomes part of the knowledge space.
Here is the CK history:
{ck_history}
Use the CK history to reason through the logical status of each concept by evaluating whether any of them can be validated or refuted based on the current knowledge space, thereby determining if it can be transformed from a concept (C) into knowledge (K). Generate a knowledge title and description from this.
        """

    @staticmethod
    def concept_to_concept(topic: str, ck_history: str) -> str:
        """C-->C operation prompt"""
        return f"""
You are an AI simulation with the goal of doing a C-->C operation from the C-K Theory.
The topic you are working on is to {topic} You are highly knowledgable in this topic area.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic. You as an AI are permitted to determine what is considered the "knowledge space". Please base your "knowledge space" on existing industry and academic standards.
Concept Space (also C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to conduct a C-->C operation. A C-->C operation in C-K theory expands the concept space by partitioning, elaborating, or generating new sub-concepts from existing concepts. This involves exploring possible attributes, variants, or directions that the current concept(s) could take without attempting to validate or refute them against the knowledge space. The aim is to create a richer set of conceptual possibilities that remain undecidable within the current knowledge space.
Here is the CK history:
{ck_history}
Use the CK history to reason about how the concepts can be further partitioned, elaborated, or expanded into new sub-concepts or alternative directions. Generate a new concept that remain in the concept space (i.e., they are not yet validated or refuted by the knowledge space), and clearly describe the new conceptual branches or possibilities you create. Transform that into a concept title and description.
        """

    @staticmethod
    def knowledge_to_knowledge(topic: str, ck_history: str) -> str:
        """K-->K operation prompt"""
        return f"""
You are an AI simulation with the goal of doing a K-->K operation from the C-K Theory.
The topic you are working on is to {topic} You are highly knowledgable in this topic area.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic. You as an AI are permitted to determine what is considered the "knowledge space". Please base your "knowledge space" on existing industry and academic standards.
Concept Space (also C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to do a K-->K operation. A K-->K operation in C-K theory expands the knowledge space by deducing, inferring, or formalizing new knowledge from existing validated propositions. This involves using what is already accepted as true or false in the knowledge space to derive additional facts, rules, or relationships that can also be logically accepted as knowledge. The aim is to enrich the knowledge space with new, validated knowledge that is logically consistent with what is already known.
Here is the CK history:
{ck_history}
Use the CK history to reason about what new knowledge can be logically deducted, inferred, or formalized based on the current knowledge. Clearly state the new knowledge propositions you generate, ensuring they are logically consistent and can be accepted as true or false within the knowledge space. Transform that into a knowledge title and description.
        """

    @staticmethod
    def knowledge_to_concept(topic: str, ck_history: str) -> str:
        """K-->C operation prompt"""
        return f"""
You are an AI simulation with the goal of doing a K-->C operation from the C-K Theory.
The topic you are working on is to {topic} You are highly knowledgable in this topic area.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic. You as an AI are permitted to determine what is considered the "knowledge space". Please base your "knowledge space" on existing industry and academic standards.
Concept Space (also C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to conduct a K-->C operation. A K-->C operation in C-K theory generates new concepts by using existing knowledge as a foundation for proposing new ideas, possibilities, or conceptual directions that are not yet validated or refuted by the current knowledge space. This involves identifying gaps, ambiguities, or opportunities in the knowledge space and formulating new concepts that remain undecidable within the current knowledge space.
Here is the CK history:
{ck_history}
Use the CK history to reason about what new concepts, ideas, or possibilities could be proposed based on the current knowledge. Describe the new concept you generate, ensuring they are not yet validated or refuted by the knowledge space and remain at open possibilities for further exploration. Generate a new concept title and description from that.
        """

    @staticmethod
    def expand_concept(
        topic: str,
        ck_history: str,
        focus_concept: str,
        target_count: int = 2,
    ) -> str:
        """Expand a selected concept into a requested number of child concepts (C-->C)."""
        return f"""
You are an AI simulation with the goal of doing a C-->C operation from the C-K Theory.
The topic you are working on is to {topic}. You are highly knowledgeable in this topic area.

Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false.
Concept Space (C) - This space consists of propositions that do not yet have a logical status in K.

Your task:
1. Focus on the selected concept shown below.
2. Expand that concept into exactly {target_count} new child concepts.
3. Each child concept must stay in Concept Space (not validated/refuted yet).
4. Make each child direction meaningfully different from the others.

CK history:
{ck_history}

Selected parent concept:
{focus_concept}

Return plain text only in this exact template:
ITEM 1
TITLE: <single-line title>
DESC: <single-line 2-3 sentence concept description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid C-->C expansion>

ITEM 2
TITLE: <single-line title>
DESC: <single-line 2-3 sentence concept description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid C-->C expansion>

Rules:
- Return exactly {target_count} concepts.
- Continue the ITEM pattern until ITEM {target_count}.
- Keep every field on a single line.
- Do not use JSON.
- Do not use markdown.
- Do not add any extra commentary before or after the template.
        """

    @staticmethod
    def decide_novel_concept(topic: str, ck_history: str) -> str:
        """Select the best concept using novelty, feasibility, usefulness, and clarity."""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}.

You must evaluate candidate concepts from the CK history and choose the single best concept.

Evaluation criteria (score each 1-10):
1. Novelty - how different it is from existing ideas.
2. Feasibility - whether it could realistically be implemented.
3. Usefulness - how well it solves the design problem.
4. Clarity - how clearly the idea is defined.

CK history:
{ck_history}

Instructions:
- Consider only entries where type is "concept".
- Select exactly one winning concept.
- Give a concise rationale that directly references the four criteria.
- Use consistent scoring.

Return valid JSON only in this exact shape:
{{
  "selected_concept_id": "C#",
  "rationale": "2-4 sentence explanation",
  "scores": {{
    "novelty": 0,
    "feasibility": 0,
    "usefulness": 0,
    "clarity": 0
  }}
}}

Rules:
- No markdown.
- No trailing commas.
- No comments.
- No text outside the JSON object.
        """

    @staticmethod
    def create_knowledge_from_concept(
        topic: str,
        ck_history: str,
        focus_concept: str,
    ) -> str:
        """Generate one new knowledge entry from the selected concept (C-->K)."""
        return f"""
You are an AI simulation with the goal of doing a C-->K operation from the C-K Theory.
The topic you are working on is to {topic}. You are highly knowledgeable in this topic area.

Knowledge Space (K) - propositions with logical status (true/false) and actionable facts.
Concept Space (C) - open propositions not yet validated in K.

Your task:
1. Focus on the selected concept below.
2. Derive one high-value new knowledge entry from that concept.
3. The knowledge entry should improve decision quality for future concept exploration.
4. Keep it specific, practical, and consistent with the topic.

CK history:
{ck_history}

Selected parent concept:
{focus_concept}

Return plain text only in this exact template:
TITLE: <single-line title>
DESC: <single-line 2-3 sentence knowledge description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid C-->K move>

Rules:
- Keep every field on a single line.
- Do not use JSON.
- Do not use markdown.
- Do not add any extra commentary before or after the template.
        """

    @staticmethod
    def create_concept_from_knowledge(
        topic: str,
        ck_history: str,
        focus_knowledge: str,
    ) -> str:
        """Generate one new concept from the selected knowledge entry (K-->C)."""
        return f"""
You are an AI simulation with the goal of doing a K-->C operation from the C-K Theory.
The topic you are working on is to {topic}. You are highly knowledgeable in this topic area.

Knowledge Space (K) - validated propositions and actionable facts with logical status.
Concept Space (C) - open propositions not yet validated in K.

Your task:
1. Focus on the selected knowledge entry below.
2. Derive one high-value new concept from that knowledge.
3. The concept should open a meaningful design direction that is not yet fully validated.
4. Keep it specific, creative, and consistent with the topic.

CK history:
{ck_history}

Selected parent knowledge:
{focus_knowledge}

Return plain text only in this exact template:
TITLE: <single-line title>
DESC: <single-line 2-3 sentence concept description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid K-->C move>

Rules:
- Keep every field on a single line.
- Do not use JSON.
- Do not use markdown.
- Do not add any extra commentary before or after the template.
        """

    @staticmethod
    def expand_knowledge(
        topic: str,
        ck_history: str,
        focus_knowledge: str,
        target_count: int = 2,
    ) -> str:
        """Expand a selected knowledge entry into a requested number of child knowledge entries (K-->K)."""
        return f"""
You are an AI simulation with the goal of doing a K-->K operation from the C-K Theory.
The topic you are working on is to {topic}. You are highly knowledgeable in this topic area.

Knowledge Space (K) - validated propositions and actionable facts with logical status.
Concept Space (C) - undecidable propositions not yet validated in K.

Your task:
1. Focus on the selected knowledge entry shown below.
2. Expand that knowledge into exactly {target_count} new child knowledge entries.
3. Each child entry must stay in Knowledge Space (specific, testable, and practically useful).
4. Make each child direction meaningfully different from the others.

CK history:
{ck_history}

Selected parent knowledge:
{focus_knowledge}

Return plain text only in this exact template:
ITEM 1
TITLE: <single-line title>
DESC: <single-line 2-3 sentence knowledge description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid K-->K expansion>

ITEM 2
TITLE: <single-line title>
DESC: <single-line 2-3 sentence knowledge description>
RATIONALE: <single-line 2-3 sentence rationale for why this is a valid K-->K expansion>

Rules:
- Return exactly {target_count} knowledge entries.
- Continue the ITEM pattern until ITEM {target_count}.
- Keep every field on a single line.
- Do not use JSON.
- Do not use markdown.
- Do not add any extra commentary before or after the template.
        """

    @staticmethod
    def validate_concept(
        topic: str,
        ck_history: str,
        focus_concept: str,
    ) -> str:
        """Validate a selected concept against the current knowledge space."""
        return f"""
You are an AI simulation with the goal of validating a concept using C-K Theory.
The topic you are working on is to {topic}. You are highly knowledgeable in this topic area.

Knowledge Space (K) - validated propositions and actionable facts with logical status.
Concept Space (C) - open propositions not yet validated in K.

Your task:
1. Focus on the selected concept shown below.
2. Evaluate whether the concept is sufficiently supported by the existing knowledge entries in CK history.
3. Mark the concept as VALID only if the current knowledge strongly supports it as feasible and coherent.
4. Mark the concept as INVALID if the current knowledge contradicts it, leaves critical gaps, or does not support implementation yet.
5. Base your reasoning only on the provided CK history.

CK history:
{ck_history}

Selected concept:
{focus_concept}

Return plain text only in this exact template:
VERDICT: VALID or INVALID
RATIONALE: <single-line 2-4 sentence explanation grounded in the existing knowledge>

Rules:
- Keep every field on a single line.
- Use exactly VALID or INVALID for the verdict.
- Do not use JSON.
- Do not use markdown.
- Do not add any extra commentary before or after the template.
        """

    @staticmethod
    def initialize_knowledge_entries(topic: str) -> str:
        """Prompt to generate initial knowledge entries based on topic"""
        return f"""
You are an AI specializing in Design Innovation using C-K Theory.
The topic you are working on is to {topic}
Context:
Your task is to generate new knowledge based on the topic.
Knowledge Space (K) - This is the space where propositions have a logical status, meaning they can be true or false. It represents what is known and accepted by a designer. The logical status can be based on standard or non-standard logic systems, but for simplicity, it is often considered as classic true or false logic.
Concept Space (C): This space consists of propositions or groups of propositions that do not have a logical status in K. Concepts are essentially ideas or properties that cannot be proven true or false within the current knowledge space. They are the starting point for design, as they represent new possibilities that are not yet part of the existing knowledge.
Your goal is to initialize the knowledge space by generating 3 relevant knowledge entries that can be used in C-K theory simulations.
Return your answer in the following JSON format:

{{
  "knowledge_entries": string[]
}}

Rules:
- Use valid JSON
- No trailing commas
- No comments
- No text outside the JSON object
"""

    @staticmethod
    def reorder_concept_entries(topic: str, ck_history: str) -> str:
        """Prompt to reorder concept entries based on their structural role in the topic."""
        return f"""
        ### ROLE
        You are a C-K Theory Structural Expert. Your goal is to optimize the C-Space (Concepts)
        for the topic: "{topic}".

        ### CURRENT C-K MAP
        {ck_history}

        ### TASK: C -> C' (Reordering)
        Review the existing concept entries. You must reorganize them into a clearer concept structure.
        Apply the following rules:

        1. REORDER: Place broad framing concepts earlier and more specific or synthesized concepts later.
        2. MERGE: If C_a and C_b are duplicates or near-duplicates, combine them into one stronger concept.
        3. RELINK: Reassign parent-child relationships when a concept is better explained by a different parent.
        4. MULTI-SOURCE: Use multiple incoming links when a concept clearly synthesizes several concepts and/or knowledge entries.
        5. REMOVE: If a concept is fully absorbed by another concept, remove it and redirect dependents.

        ### OUTPUT
        Return valid JSON only in this exact shape:

        {{
          "concept_entries": [
            {{
              "id": "C1",
              "type": "concept",
              "title": "...",
              "desc": "...",
              "reordering_rationale": "...",
              "parent_id": "C0",
              "source_parent_ids": ["C0", "K1"]
            }}
          ],
          "removed_concept_ids": ["C2"],
          "redirected_ids": {{
            "C2": "C1"
          }},
          "rationale": "2-4 sentence summary of the overall reordering logic"
        }}

        Requirements:
        - "concept_entries" must contain every concept node that should remain after reordering, in the desired top-to-bottom order.
        - Keep an existing concept ID whenever possible, especially for MERGE. Prefer choosing one surviving existing ID instead of inventing a new one.
        - If a concept node is removed, include its ID in "removed_concept_ids".
        - Every removed concept ID should appear in "redirected_ids" with the surviving concept ID that dependent nodes should reconnect to.
        - "parent_id" and "source_parent_ids" must use IDs that exist in the CK history or in the returned "concept_entries".
        - "source_parent_ids" may include both concept IDs and knowledge IDs when a concept is supported by multiple upstream nodes.
        - Use "source_parent_ids" to preserve multiple incoming connections when needed. If there is only one incoming connection, include that single ID.
        - If a relationship no longer holds, do not include it in "source_parent_ids".
        - Do not return any concept ID in both "concept_entries" and "removed_concept_ids".
        - Do not add markdown, comments, or text outside the JSON object.

        Example:
        {{
            "concept_entries": [
                {{
                    "id": "C1",
                    "type": "concept",
                    "title": "...",
                    "desc": "...",
                    "reordering_rationale": "Merged C1 and C2 because...",
                    "parent_id": "C0",
                    "source_parent_ids": ["C0", "K1"]
                }}
            ],
            "removed_concept_ids": ["C2"],
            "redirected_ids": {{
                "C2": "C1"
            }},
            "rationale": "C1 and C2 were merged because they described the same design direction, while the remaining concepts were reordered from broad framing ideas to more specialized derivatives."
        }}
        """

    @staticmethod
    def reorder_knowledge_entries(topic: str, ck_history: str) -> str:
        """Prompt to reorder knowledge entries based on their relevance to the topic"""
        return f"""
        ### ROLE
        You are a C-K Theory Structural Expert. Your goal is to optimize the K-Space (Knowledge)
        for the topic: "{topic}".

        ### CURRENT KNOWLEDGE BASE
        {ck_history}

        ### TASK: K -> K' (Reordering)
        Review the existing knowledge entries. You must reorganize them to preserve meaning
        and reduce cognitive load. Apply the following rules:

        1. MERGE: If K_a and K_b are redundant, combine them into a single, more robust entry.
        2. NEST: If K_c is a subset of K_d, create a hierarchical relationship.
        3. REDEFINE: If a previous Concept (C) has proven a Knowledge entry (K) to be
           narrow or incorrect, rewrite K to be more accurate.
        4. DISCONNECT: If a relationship between two K-entries no longer holds, remove the link.

        ### OUTPUT
        Return valid JSON only in this exact shape:

        {{
          "knowledge_entries": [
            {{
              "id": "K1",
              "type": "knowledge",
              "title": "...",
              "desc": "...",
              "reordering_rationale": "...",
              "parent_id": "C0",
              "source_parent_ids": ["C0"]
            }}
          ],
          "removed_knowledge_ids": ["K2"],
          "redirected_ids": {{
            "K2": "K1"
          }},
          "rationale": "2-4 sentence summary of the overall reordering logic"
        }}

        Requirements:
        - "knowledge_entries" must contain every knowledge node that should remain after reordering, in the desired top-to-bottom order.
        - Keep an existing knowledge ID whenever possible, especially for MERGE. Prefer choosing one surviving existing ID instead of inventing a new one.
        - If a knowledge node is removed, include its ID in "removed_knowledge_ids".
        - Every removed knowledge ID must appear in "redirected_ids" with the surviving concept or knowledge ID that dependent nodes should reconnect to.
        - "parent_id" and "source_parent_ids" must use IDs that exist in the CK history or in the returned "knowledge_entries".
        - Use "source_parent_ids" to preserve multiple incoming connections when needed. If there is only one incoming connection, include that single ID.
        - If a relationship no longer holds, do not include it in "source_parent_ids".
        - Do not return any knowledge ID in both "knowledge_entries" and "removed_knowledge_ids".
        - Do not add markdown, comments, or text outside the JSON object.

        Example:
        {{
            "knowledge_entries": [
                {{
                    "id": "K1",
                    "type": "knowledge",
                    "title": "...",
                    "desc": "...",
                    "reordering_rationale": "Merged K1 and K2 because...",
                    "parent_id": "C0",
                    "source_parent_ids": ["C0"]
                }}
            ],
            "removed_knowledge_ids": ["K2"],
            "redirected_ids": {{
                "K2": "K1"
            }},
            "rationale": "K1 and K2 were merged because they repeated the same evidence, while the remaining entries were nested to reduce duplication."
        }}
        """

    @staticmethod
    def place_knowledge_in_archipelago(topic: str, existing_knowledge_json: str, new_knowledge_json: str) -> str:
        """Decide if new knowledge connects to existing knowledge nodes or stands alone as a new island."""
        return f"""You are mapping a knowledge archipelago — a space of ideas that form islands, some connected, some isolated.

Topic: {topic}

Existing knowledge in the map:
{existing_knowledge_json}

New knowledge to place:
{new_knowledge_json}

Decide whether this new knowledge connects to any existing knowledge entries. A connection means there is a meaningful intellectual relationship — such as a dependency, elaboration, contrast, shared context, or mutual reinforcement. Do NOT connect entries just because their topics superficially overlap.

If the new knowledge is genuinely distinct — a new island in the archipelago — list no connections.
If it connects to one or more existing entries, list their IDs.

Respond in exactly this format (no extra text):
CONNECTED_TO: <comma-separated knowledge IDs, e.g. K1, K3> or CONNECTED_TO: none
RATIONALE: <2-3 sentences explaining the placement decision>"""

    @staticmethod
    def place_concept_in_tree(topic: str, existing_concepts_json: str, new_concept_json: str) -> str:
        """Decide the best parent concept for a new concept, or none if it should be a new root branch."""
        return f"""You are organizing a concept tree for C-space exploration.

Topic: {topic}

Existing concepts in the map:
{existing_concepts_json}

New concept to place:
{new_concept_json}

Choose the single best parent concept ID for this new concept.
- Prefer a parent that this concept concretely extends, specializes, or branches from.
- If no existing concept is an appropriate parent, return C0.
- Do not choose multiple parents.

Respond in exactly this format (no extra text):
PARENT_ID: <concept ID, e.g. C3> or PARENT_ID: C0
RATIONALE: <2-3 sentences explaining the placement decision>"""

    # ─── Merge prompts ────────────────────────────────────────────────────────

    @staticmethod
    def detect_merge_conflicts(
        topic: str,
        concepts_a_json: str,
        concepts_b_json: str,
        knowledge_a_json: str,
        knowledge_b_json: str,
        owner_a: str = "Designer A",
        owner_b: str = "Designer B",
    ) -> str:
        return f"""You are reviewing two independently built C-K boards for the same design topic.

Topic:
{topic}

{owner_a}'s concepts:
{concepts_a_json}

{owner_b}'s concepts:
{concepts_b_json}

{owner_a}'s knowledge:
{knowledge_a_json}

{owner_b}'s knowledge:
{knowledge_b_json}

Your task is to identify merge conflicts between the two boards.

Only use these conflict types:
- duplicate_concept
- duplicate_knowledge
- concept_rejected_by_knowledge
- contradicting_concept

Definitions:
- duplicate_concept: both concepts express nearly the same design direction and should likely be unified.
- duplicate_knowledge: both knowledge nodes express nearly the same knowledge and should likely be unified.
- concept_rejected_by_knowledge: a concept from one side is challenged, constrained, or rejected by a knowledge node from the other side.
- contradicting_concept: two concepts propose incompatible design directions for the same issue.

Rules:
- Compare only across the two boards, never within the same board.
- Ignore the shared immutable initial concept if it appears in both boards.
- Do not invent IDs.
- Each conflict must reference exactly one node from side A and one node from side B.
- Prefer precision over recall. Do not emit weak or speculative conflicts.

Return a JSON array only. Each object must follow this exact shape:
{{
  "conflict_type": "duplicate_concept",
  "node_a_id": "a:C1",
  "node_b_id": "b:C2",
  "explanation": "These two concepts both propose adaptive onboarding that changes guidance based on user progress.",
  "suggested_resolution": {{
    "choice": "custom",
    "title": "Adaptive guided onboarding",
    "desc": "A short onboarding flow that adapts its guidance to user progress and need.",
    "rationale": "The ideas overlap strongly, so combining them into one clearer concept keeps the strongest parts of both."
  }}
}}

Suggested resolution rules:
- choice must be one of: "a", "b", "both", "custom"
- Use "custom" when the best result is a merged or refined node.
- For duplicate_concept and duplicate_knowledge, usually prefer "custom" or one side.
- For concept_rejected_by_knowledge, use "custom" if the concept should be revised rather than discarded.
- For contradicting_concept, use "a", "b", "both", or "custom" depending on whether the concepts can coexist.

If there are no conflicts, return [].
Return only the JSON array."""

    @staticmethod
    def detect_knowledge_conflicts(
        topic: str,
        knowledge_a_json: str,
        knowledge_b_json: str,
        owner_a: str = "Designer A",
        owner_b: str = "Designer B",
    ) -> str:
        """
        Step 1 of the merge pipeline.
        Compare both designers' K-spaces and surface all semantic conflicts.
        Handles pairwise clashes AND combination-level incompatibilities.
        """
        return f"""### ROLE
You are a C-K Theory merge expert. Two designers have independently developed knowledge spaces
for the same initial concept. Your task is to detect every semantic conflict between them so
the team can review and resolve them before the knowledge spaces are unified.

### TOPIC
{topic}

### BACKGROUND — K-RELATIVITY
In C-K Theory, knowledge is always relative to the designer's reference frame. Two propositions
that appear compatible in isolation can clash when viewed in the same K-space, because each
designer may have taken different background assumptions as given. Flag these as K-RELATIVITY
conflicts even when neither statement is strictly false on its own.

### CONFLICT TYPES
Use exactly one of these labels per detected conflict:

- CONTRADICTION   — one statement asserts P, the other asserts ¬P (direct logical clash).
- K_RELATIVITY    — the same phenomenon is described from incompatible reference frames or
                    with incompatible background assumptions; neither statement is wrong alone,
                    but they cannot coexist in a shared K-space without clarification.
- INCOMPATIBILITY — two or more statements are individually valid but cannot all be true
                    simultaneously; their conjunction implies a falsehood or a design dead-end.
- NEAR_DUPLICATE  — the same proposition stated twice in different wording; should be unified
                    into a single canonical entry.

### {owner_a.upper()}'S KNOWLEDGE SPACE
{knowledge_a_json}

### {owner_b.upper()}'S KNOWLEDGE SPACE
{knowledge_b_json}

### TASK
1. Compare every node in {owner_a}'s space against every node in {owner_b}'s space.
2. Also look for COMBINATION conflicts: groups of 2–3 nodes (from either or both spaces) whose
   conjunction implies a falsehood or a design contradiction.
3. For each conflict, record:
   - the IDs involved (one or more from each side)
   - the conflict type
   - a single precise sentence explaining the clash, grounded in the actual content of the nodes
   - which owner each set of IDs belongs to

Return a JSON array. Each element must follow this exact shape:

{{
  "ids_a": ["K1"],
  "ids_b": ["K3"],
  "type": "CONTRADICTION",
  "explanation": "K1 states that X is always true, but K3 states X is false under the same conditions.",
  "owner_a": "{owner_a}",
  "owner_b": "{owner_b}"
}}

For combination conflicts involving multiple nodes from the same side:
{{
  "ids_a": ["K2", "K4"],
  "ids_b": ["K1"],
  "type": "INCOMPATIBILITY",
  "explanation": "K2 and K4 together imply Y must hold, but K1 rules out Y.",
  "owner_a": "{owner_a}",
  "owner_b": "{owner_b}"
}}

Rules:
- If no conflicts exist, return [].
- ids_a must contain only IDs from {owner_a}'s space.
- ids_b must contain only IDs from {owner_b}'s space.
- Do not invent IDs. Use only IDs provided above.
- Do not include commentary, markdown, or text outside the JSON array.
- Return only the JSON array."""

    @staticmethod
    def restructure_merged_knowledge(
        topic: str,
        all_knowledge_json: str,
        resolved_conflicts_json: str,
    ) -> str:
        """
        Step 3 of the merge pipeline.
        After conflict resolutions are submitted, reorganize the combined K-space
        into a single, coherent, logically structured knowledge graph.
        """
        return f"""### ROLE
You are a C-K Theory structural expert. Two designers have merged their knowledge spaces for
a shared design project. Conflict resolutions have been applied. Your task is to reorganize the
combined knowledge into a single, coherent K-space that:
  1. Eliminates redundancy (no duplicate propositions).
  2. Preserves every retained piece of knowledge — do not delete information without a resolution.
  3. Groups related entries hierarchically (parent–child where one generalizes the other).
  4. Connects laterally related entries via source_parent_ids when they share a common basis.
  5. Produces a report of every structural change made.

### TOPIC
{topic}

### COMBINED KNOWLEDGE (after resolution)
{all_knowledge_json}

### APPLIED CONFLICT RESOLUTIONS
{resolved_conflicts_json}

### TASK
Restructure the combined knowledge into an ordered list of knowledge nodes.

Return valid JSON only in this exact shape:

{{
  "knowledge_entries": [
    {{
      "id": "K1",
      "type": "knowledge",
      "title": "...",
      "desc": "...",
      "parent_id": "C0",
      "source_parent_ids": ["C0"],
      "restructure_note": "Kept as-is from Designer A."
    }}
  ],
  "removed_knowledge_ids": ["K5"],
  "redirected_ids": {{"K5": "K1"}},
  "change_report": "2–4 sentence summary of every structural change made."
}}

Rules:
- Preserve all IDs that survived conflict resolution; only omit nodes explicitly discarded.
- Every removed ID must appear in redirected_ids with a surviving replacement.
- restructure_note must explain what happened to each node (kept, merged, reworded, relinked).
- Do not add markdown, comments, or text outside the JSON object."""

    @staticmethod
    def revalidate_concepts_after_merge(
        topic: str,
        merged_knowledge_json: str,
        concepts_a_json: str,
        concepts_b_json: str,
        owner_a: str = "Designer A",
        owner_b: str = "Designer B",
    ) -> str:
        """
        Step 4 of the merge pipeline.
        Re-validate every concept against the new shared K-space, and detect concept-level
        conflicts between the two designers' C-spaces.
        """
        return f"""### ROLE
You are a C-K Theory validation expert. Two designers have been working on the same initial
concept and have now merged their knowledge spaces. Using the new shared K-space, you must:
  1. Re-validate every concept from both boards.
  2. Detect concept-level conflicts: pairs of concepts (one from each board) that are
     semantically similar but received different validation verdicts, or that represent
     contradictory design directions that cannot coexist in one concept tree.

### TOPIC
{topic}

### MERGED KNOWLEDGE SPACE
{merged_knowledge_json}

### {owner_a.upper()}'S CONCEPTS
{concepts_a_json}

### {owner_b.upper()}'S CONCEPTS
{concepts_b_json}

### TASK A — Re-validation
For every concept listed above, evaluate whether the merged knowledge now supports (approved),
refutes (rejected), or remains ambiguous about (undecidable) that concept.

### TASK B — Concept conflict detection
Find pairs of concepts — one from {owner_a}, one from {owner_b} — where:
- Both address the same design dimension but with conflicting attributes or verdicts.
- They represent mutually exclusive design directions (accepting one rules out the other).

### OUTPUT FORMAT
Return valid JSON only:

{{
  "revalidated": [
    {{
      "id": "C1",
      "owner": "{owner_a}",
      "validationStatus": "approved",
      "rationale": "One sentence grounded in specific merged knowledge entries."
    }}
  ],
  "concept_conflicts": [
    {{
      "concept_a_id": "C2",
      "concept_b_id": "C3",
      "owner_a": "{owner_a}",
      "owner_b": "{owner_b}",
      "explanation": "C2 proposes attribute X while C3 proposes attribute ¬X for the same design requirement."
    }}
  ]
}}

Rules:
- validationStatus must be exactly: approved, rejected, or undecidable.
- Every concept ID from both lists must appear in revalidated.
- concept_conflicts may be an empty array if no clashes exist.
- Do not add markdown, comments, or text outside the JSON object."""
