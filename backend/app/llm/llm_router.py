import os
import json

from openai import OpenAI
from dotenv import load_dotenv
from .llm_prompt import DB_SCHEMA_analyze, CHAT_SYSTEM_PROMPT

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
                "You are a concise NYC rental advisor explaining to someone looking for a property to rent. "
                "In 2-3 sentences explain how well the property matches the user's needs. "
                "Plain text only, either in paragraph or bullet point."
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


def explain_result(user_prefs: dict, priority_order: list, ols_coef: dict,
                neighborhood: str, concern: str, result_summary: dict = None) -> str:
    """Return a 3-5 sentence plain-text explanation of the filtered recommendation results,
    covering which regions scored well, what features mattered, and non-obvious patterns."""

    # Sort coefficients by absolute magnitude
    sorted_coef = sorted(ols_coef.items(), key=lambda x: abs(x[1]), reverse=True)
    coef_lines = "\n".join(f"  {k}: {v:+.4f}" for k, v in sorted_coef)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a friendly NYC rental advisor summarizing the results of a personalized property recommendation. "
                "Write 3-5 sentences in plain conversational English directly to the user. "
                "Your goal is to tell them what the recommendation learned and where the best-matching properties ended up.\n\n"
                "Cover these points, but only if interesting:\n"
                "1. Which borough or neighborhood areas scored highest and why (based on the result_summary data).\n"
                "2. Any area or feature that scored notably lower than expected — worth mentioning if surprising.\n"
                "3. One or two non-obvious insights from the OLS coefficients: things the user's survey revealed that go beyond "
                "   the obvious (e.g. not 'you prefer cheaper rent' — that is always true and adds no value). "
                "   Focus on secondary features like noise tolerance, park proximity, building age, elevator, floor count — "
                "   anything that reveals something the user may not have realized about their own priorities.\n\n"
                "Do NOT mention: coefficient values, numbers, technical terms, or the word 'coefficient'. "
                "Do NOT state the obvious (rent preference, basic bedroom/bathroom match). "
                "Feature name translation: rent_knn=rent, sqft=apartment size, bedroomnum_diff=bedroom fit, "
                "bathroomnum_diff=bathroom fit, borocode_match=borough match, built_year_diff=building age preference, "
                "bld_story_diff=floor count preference, elevator=elevator access, dist_greenspace_ft=proximity to green space, "
                "dist_subway_ft=subway proximity, noise_level_ord=noise sensitivity. "
                "Positive coefficient = user preferred more/higher of that feature; negative = preferred less. "
                "For _diff features, a strong negative means the user cared a lot about matching their stated preference exactly. "
                "Plain text only — no bullet points, no headers, no JSON."
            ),
        },
        {
            "role": "user",
            "content": json.dumps({
                "user_preferences": {
                    "target_rent":    user_prefs.get("rent"),
                    "bedrooms":       user_prefs.get("bedrooms"),
                    "bathrooms":      user_prefs.get("bathrooms"),
                    "priority_order": priority_order,
                    "neighborhood":   neighborhood,
                    "concern":        concern,
                },
                "ols_coefficients_by_importance": coef_lines,
                "result_summary": result_summary or {},
            }, ensure_ascii=False),
        },
    ]

    resp = client.responses.create(model="gpt-5-nano", input=messages)
    usage = resp.usage
    print(f"[llm] /explain_result tokens — input: {usage.input_tokens}  output: {usage.output_tokens}")
    return resp.output_text.strip()


def chat_query(user_message: str, history: list, properties: list = []) -> dict:
    """
    Process a chat message and return a structured JSON response.
    history: list of {"role": "user"|"assistant", "content": str}
    properties: list of property dicts dragged into chat context (max 3)
    Returns parsed dict with "filters", "sort", or "message" key.
    """
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]

    if properties:
        prop_summaries = []
        for i, p in enumerate(properties[:3]):
            summary = {k: p[k] for k in (
                "final_score",
                "rent_knn", "sqft", "bedroomnum", "bathroomnum", "livingroomnum",
                "elevator", "bld_story", "built_year", "borocode",
                "large_n", "small_n", "noise_level_ord",
                "dist_subway_ft", "dist_greenspace_ft", "dist_major_park_ft",
                "bldg_class", "zoning",
            ) if k in p and p[k] is not None}
            prop_summaries.append({"property": i + 1, **summary})

        messages.append({
            "role": "system",
            "content": (
                "The user has loaded the following propert"
                + ("y" if len(prop_summaries) == 1 else "ies")
                + " into the chat for reference:\n"
                + json.dumps(prop_summaries, ensure_ascii=False)
                + "\n\nWhen the user says 'this property', 'similar to this', 'like this one', "
                "or refers to a loaded property by number, use its column values to build "
                "FILTER constraints. For 'similar': match borocode, bedroomnum, bathroomnum, "
                "and use a ±20% rent range. Translate all column values into the correct "
                "filter or sort output format."
            ),
        })

    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

    resp = client.responses.create(model="gpt-5-nano", input=messages)
    usage = resp.usage
    print(f"[llm] /chat tokens — input: {usage.input_tokens}  output: {usage.output_tokens}")

    raw = resp.output_text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    # If the model added preamble text before the JSON object, extract just the object
    if not raw.startswith("{"):
        start = raw.find("{")
        end   = raw.rfind("}")
        if start != -1 and end > start:
            raw = raw[start:end + 1]
    print(f"[llm] /chat raw → {raw[:200]}")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"[llm] /chat JSONDecodeError on: {raw[:300]}")
        return {"message": "I have trouble understanding that. Could you rephrase your request?"}
