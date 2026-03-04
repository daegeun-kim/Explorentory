import os
import json
from typing import List, Optional

from openai import OpenAI
from dotenv import load_dotenv
from .llm_prompt import DB_SCHEMA_analyze

load_dotenv(dotenv_path="../.env")
api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=api_key)



def select_mode(combined_query: str) -> list:
    return [
        {
            "role": "system",
            "content": (
                "Determine the application mode for nyc spatial analysis. "
                "Classify into: analyze, search, compare. "
                "analyze: user wants to analyze one specific region (city, borough or neighborhood). "
                "search: user wants to find out which region, borough or neighborhood is the most desirable. "
                "compare: user explicitly names TWO distinct regions for comparison; in this case ALWAYS overrides analyze. "
                "if user mentions a infers a region below the scale of a borough (eg: midtown, place closer to river), mode=analyze"
                "Return JSON only: {\"mode\":\"...\"}."
            )
        },
        {"role": "user", "content": combined_query}
    ]


def build_analyze_plan(combined_query: str) -> list:
    return [
        {
            "role": "system",
            "content": (
                "You map a natural language query to a structured analysis plan.\n"
                "Return JSON only, with exactly keys: (column, dtype, scale, region, table, filters)\n"
                "The 'combined_query' text may optionally include previous conversation context plus the user's current question; "
                "base your plan on the user's latest intent and corrections.\n"
                "Rules:\n"
                "- column should be the most relevant column based on the combined_query from the choice of table(must exist in the chosen table and match dtype.)\n"
                "- dtype is inferred from DB_SCHEMA.(\"numeric|categorical\")\n"
                "- scale = \"large_n\" if a value of large_n can be specified or inferred based on combined_query by any mean.\n"
                "- If scale = \"city\": region = null, filters should not include borocode or large_n.\n"
                "- If scale = \"borough\":\n"
                "  region is borocode (int, 1-5) and filters must include [\"borocode\", \"=\", region],and does not include [\"large_n\", \"=\", region].\n"
                "- If scale = \"large_n\":\n"
                "  region is one of large_n (string) and filters must include [\"large_n\", \"=\", region].\n"
                "- table = \"street_block\" when scale in [\"city\",\"borough\"],\n"
                "  table = \"buildings\" when scale = \"large_n\".\n"
                "- filters is a list of [column, op, value] using only columns from the chosen table.\n"
                "- regional filters ('borocode =' or 'large_n =' should be at most 1)"
                "- Allowed ops in filters: \"=\", \">\", \"<\", \">=\", \"<=\".\n"
                "- Never use 'geom' as column.\n"
                "- If unsure, set column = \"NO_MATCH\" but better avoid.\n"
                "- EVERY TEST for each item inside json MUST be from on schema. DO NOT fabricate text."
                "\n"
                "Examples response for queries:\n"
                "Query: \"in Midtown Manhattan, show buildings above 100m\"\n"
                "→ {\"column\":\"heightroof\",\"dtype\":\"numeric\",\"scale\":\"large_n\",\"region\":\"midtown manhattan\","
                "\"table\":\"buildings\",\"filters\":[[\"large_n\",\"=\",\"midtown manhattan\"],[\"heightroof\",\">\",\"328.084\"]]}\n"
                "\n"
                "Respond with JSON only, no extra text."
            ),
        },
        {
            "role": "user",
            "content": f"Schema:\n{DB_SCHEMA_analyze}\n\nQuery:\n{combined_query}",
        },
    ]


def build_search_plan(combined_query: str) -> list:
    return [
        {
            "role": "system",
            "content": (
                "Map the query to two columns:\n"
                "Return JSON only, with exactly keys: (column_b, column_s, dtype_s, dtype_b, scale, analysis, order)\n"
                "The 'Query' text may optionally include previous conversation context plus the user's current question; "
                "base your plan on the user's latest intent and corrections.\n"
                "- column_s: most relevant column from street_block\n"
                "- column_b: most relevant column from from buildings\n"
                "Both column_b and s must represent the SAME variable (height, value, density, etc.).\n"
                "- dtype_s: data type of column_s (numeric|categorical)\n"
                "- dtype_b: data type of column_b (numeric|categorical)\n"
                "- scale: unless query mentions a word refering to borough (eg: 'borough', 'boro'), always return 'large_n' (borough|large_n)\n"
                "- analysis: most appropriate analysis information from data (min|max|mean|median)"
                "- order: ascending if the wanted information is the least value, descending if the most such as highest/biggest/tallest. (ascending|descending)"

                "Rules:\n"
                "- Do NOT choose id/grouping columns (borocode, large_n, small_n, geom, ids).\n"
                "- Use semantically matched pairs. Examples:\n"
                "  height → height_avg (street_block) ↔ heightroof (buildings)\n"
                "  value  → value_avg (street_block) ↔ value_sqft (buildings)\n"
                "  density → density_s (street_block) ↔ density_b (buildings)\n"
                "- If unsure, set BOTH column_s and column_b to \"NO_MATCH\".\n"
                "- scale default = large_n.\n"
                "Examples response for queries:\n"
                "Query: \"search for the region with cheapest average building value.\"\n"
                "→ {\"column_s\":\"avg_prop_value_2025\",\"column_b\":\"prop_val_2025_avg\",\"dtype_s\":\"numeric\",\"dtype_b\":\"numeric\","
                "\"scale\":\"large_n\",\"analysis\":\"mean\",\"order\":\"ascending\"}\n"
                "\n"
                "Respond with JSON only, no extra text."
            ),
        },
        {
            "role": "user",
            "content": f"Schema:\n{DB_SCHEMA_analyze}\n\nQuery:\n{combined_query}",
        },
    ]


def build_compare_plan(combined_query: str) -> list:
    return [
        {
            "role": "system",
            "content": (
                "You convert a natural-language comparison query into a structured compare plan.\n"
                "\n"
                "Return JSON only, with exactly these keys:\n"
                "{"
                "\"column\":\"...\","
                "\"dtype\":\"numeric|categorical|boolean\","
                "\"scale\":\"borough|large_n\","
                "\"region1\": null|int|string,"
                "\"region2\": null|int|string,"
                "\"table\":\"street_block|buildings\","
                "\"filters\":[[\"col\",\"op\",\"value\"], ...]"
                "}\n"
                "\n"
                "The 'Query' text may optionally include previous conversation context plus the user's current question; "
                "base your plan on the user's latest intent and corrections.\n"
                "Rules:\n"
                "- column must exist in the chosen table and match dtype.\n"
                "- dtype is inferred from DB_SCHEMA.\n"
                "- The query must describe a comparison between two regions.\n"
                "- scale = \"borough\" when regions are boroughs; scale = \"large_n\" when regions are large neighborhoods.\n"
                "- region1 and region2 are the two regions the query wants to compare, and they must be in the same scale.\n"
                "- If scale = \"borough\":\n"
                "  - region1 and region2 are borocode (int, 1–5).\n"
                "  - table = \"street_block\".\n"
                "- If scale = \"large_n\":\n"
                "  - region1 and region2 are large_n names (string).\n"
                "  - table = \"buildings\".\n"
                "- filters is a list of [column, op, value] using only columns from the chosen table, excluding borocode and large_n.\n"
                "- Allowed ops in filters: \"=\", \">\", \"<\", \">=\", \"<=\".\n"
                "- Never use id/grouping-only fields (geom, internal ids) as column.\n"
                "- If you cannot confidently map the query to a valid column, set column = \"NO_MATCH\".\n"
                "\n"
                "Examples (format only, not tied to the schema):\n"
                "Query: \"compare highest building in midtown and downtown manhattan above 100m\"\n"
                "→ {\"column\":\"heightroof\",\"dtype\":\"numeric\",\"scale\":\"large_n\",\"region1\":\"midtown manhattan\",\"region2\":\"downtown manhattan\","
                "\"table\":\"buildings\",\"filters\":[[\"heightroof\",\">\",\"328.084\"]]}\n"
                "\n"
                "Respond with JSON only, no extra text."
            ),
        },
        {
            "role": "user",
            "content": f"Schema:\n{DB_SCHEMA_analyze}\n\nQuery:\n{combined_query}",
        },
    ]
