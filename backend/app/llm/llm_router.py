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
                neighborhood: str, concern: str) -> str:
    """Return a 3-5 sentence plain-text explanation of what the ML model learned
    from the user's survey ratings, framed in terms of preferences."""

    # Sort coefficients by absolute magnitude for the prompt
    sorted_coef = sorted(ols_coef.items(), key=lambda x: abs(x[1]), reverse=True)
    coef_lines = "\n".join(f"  {k}: {v:+.4f}" for k, v in sorted_coef)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a friendly NYC rental advisor. "
                "Based on OLS regression coefficients from the user's property ratings, "
                "write 2-4 sentences telling the user what their survey revealed about their preferences. "
                "Speak directly to the user in plain conversational English — no numbers, no coefficient values, no technical terms. "
                "Focus only on the top 3-4 most influential features (highest absolute coefficient). "
                "Translate feature names: rent_knn=rent, sqft=apartment size, bedroomnum_diff=bedroom match, "
                "bathroomnum_diff=bathroom match, borocode_match=staying in same borough, "
                "built_year_diff=building age, bld_story_diff=number of floors, elevator=elevator access, "
                "dist_greenspace_ft=proximity to parks, dist_subway_ft=subway access, noise_level_ord=noise level. "
                "Positive coefficient = user preferred more/higher; negative = preferred less/lower. "
                "For _diff features, negative coefficient means the user disliked deviating from their stated preference. "
                "Plain text only — no bullet points, no numbers, no JSON."
            ),
        },
        {
            "role": "user",
            "content": json.dumps({
                "user_preferences": {
                    "target_rent":   user_prefs.get("rent"),
                    "bedrooms":      user_prefs.get("bedrooms"),
                    "bathrooms":     user_prefs.get("bathrooms"),
                    "priority_order": priority_order,
                    "neighborhood":  neighborhood,
                    "concern":       concern,
                },
                "ols_coefficients_by_importance": coef_lines,
                "interpretation_guide": (
                    "rent_knn: monthly rent; sqft: size; bedroomnum_diff: bedroom match; "
                    "bathroomnum_diff: bathroom match; borocode_match: same borough; "
                    "built_year_diff: building age preference; bld_story_diff: floor count preference; "
                    "elevator: has elevator; dist_greenspace_ft: proximity to parks; "
                    "dist_subway_ft: proximity to subway; noise_level_ord: noise (0=very low, 4=very high)"
                ),
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

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"message": "I have trouble understanding that. Could you rephrase your request?"}
