class ToolEngine:
    pass

class CKToolEngine(ToolEngine):
    def __init__(self):
        pass
    
    @staticmethod
    def choose_concept_or_knowledge_tool():
        """Tool for choosing between Concept (C) and Knowledge (K)"""
        return [
            {
                "type": "function",
                "name": "choose_K_or_C",
                "description": "Select whether the next step in C-K theory is 'concept' or 'knowledge'.",
                "strict": True,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "decision": {
                            "type": "string",
                            "enum": ["Concept", "Knowledge"]
                        }
                    },
                    "required": ["decision"],
                    "additionalProperties": False
                },
            }
        ]
