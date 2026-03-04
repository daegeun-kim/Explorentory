import json
from openai import OpenAI

client = OpenAI()

def call_llm(messages: list, model: str = "gpt-5-nano"):
    resp = client.responses.create(
        model=model,
        input=messages,
    )

    raw = resp.output_text.strip()
    print("RAW:", repr(raw))

    try:
        parsed = json.loads(raw)
        error = None
    except Exception as e:
        print("JSON parse error:", e)
        parsed = None
        error = "LLM_OUTPUT_FORMAT_ERROR"

    usage = {
        "total": resp.usage.total_tokens,
        "input": resp.usage.input_tokens,
        "output": resp.usage.output_tokens,
    }
    
    return parsed, usage, error