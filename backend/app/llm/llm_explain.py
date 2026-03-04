import json
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path="../.env")
api_key = os.getenv("OPENAI_API_KEY")

client = OpenAI(api_key=api_key)


def llm_explain(query: str, summary: dict) -> str:
    summary_json = json.dumps(summary, ensure_ascii=False)

    system_msg = (
        "You are an urban data analyst and helpful conversational assistant. "
        "Answer the user’s question in natural language using both your own knowledge "
        "and the numeric summary provided. "
        "Treat the JSON summary as ground truth about the data and describe patterns, "
        "typical ranges, and extremes clearly. "
        "Answer the question directly; do NOT talk about JSON, columns, or field names, "
        "and do NOT suggest making plots or further analyses unless the user explicitly asks. "
        "When the user asks to 'show' a distribution, describe its shape (e.g., where most values lie, "
        "whether it is skewed, presence of outliers) in words. "
        "Write concise, well-structured English in about 70 words ±20, using short paragraphs or bullet points. "
        "If region is a number, it is a NYC borocode; convert it to the corresponding borough name in your explanation."
        "when explaining with numbers, include the unit"
    )

    user_msg = (
        f"User question:\n{query}\n\n"
        "Below are precomputed summary statistics from the relevant dataset, in JSON format. "
        "Use these numbers as factual evidence when answering, but do not mention JSON, keys, or field names explicitly:\n"
        f"{summary_json}"
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-5-nano",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
        )

        content = resp.choices[0].message.content
        if not content:
            return "[No explanation generated]"
        return content.strip()

    except Exception as e:
        return f"[llm_explain error: {e}]"
