import os
import json

from openai import OpenAI
from dotenv import load_dotenv
from .llm_prompt import DB_SCHEMA_analyze

load_dotenv(dotenv_path="../.env")
api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=api_key)


def explain_property(user_prefs: dict, property_info: dict) -> str:
    """Return a 2-3 sentence plain-text explanation of how well
    the property fits the user's preferences and stated concern."""

    messages = [
        {
            "role": "system",
            "content": (
                "You are a concise NYC rental advisor. "
                "In 2-3 sentences explain how well the property matches the user's needs. "
                "Be specific about rent, size, location, and any stated concern. "
                "Plain text only — no bullet points, no JSON."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "user_preferences": user_prefs,
                    "property": property_info,
                    "field_reference": DB_SCHEMA_analyze,
                },
                ensure_ascii=False,
            ),
        },
    ]

    resp = client.responses.create(model="gpt-5-nano", input=messages)

    usage = {
        "total": resp.usage.total_tokens,
        "input": resp.usage.input_tokens,
        "output": resp.usage.output_tokens,
    }
    print(f"[llm] /explain tokens — input: {usage['input']}  output: {usage['output']}  total: {usage['total']}")

    return resp.output_text.strip()
