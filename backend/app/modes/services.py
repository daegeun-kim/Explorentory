import traceback
import json
import pandas as pd
from typing import List, Dict, Optional

from ..llm.llm_router import select_mode, build_analyze_plan, build_search_plan, build_compare_plan
from ..llm.llm_client import call_llm
from ..db import get_data_analyze, get_data_search, get_data_search_final, get_data_compare
from ..llm.llm_explain import llm_explain

def keep_only_region_filter(filters):
    region_keys = {"borocode", "large_n"}
    region_filters = []

    for f in filters:
        # expect [column, op, value]
        if not isinstance(f, (list, tuple)) or len(f) < 3:
            continue
        col, op, val = f[0], f[1], f[2]
        if col in region_keys:
            region_filters.append([col, op, val])

    # if multiple region filters exist, keep only the first one
    if region_filters:
        return [region_filters[0]]
    return []

def create_summary(gdf, column: str, scale, region, dtype):
    print("[create_summary] dtype:", dtype, "column:", column, "scale:", scale, "region:", region)

    if dtype == 'numeric':
        if gdf is None or column is None or column not in gdf.columns:
            result = {
                "count": 0,
                "mean": None,
                "median": None,
                "min": None,
                "max": None,
            }
            print("[create_summary] Numeric: gdf/column invalid, returning:", result)
            return result

        s = gdf[column].dropna()
        if s.empty:
            result = {
                "count": 0,
                "mean": None,
                "median": None,
                "min": None,
                "max": None,
            }
            print("[create_summary] Numeric: empty series, returning:", result)
            return result

        result = {
            "data": column,
            "scale of analysis": scale,
            "region": region,
            "count": int(s.count()),
            "mean": float(s.mean()),
            "median": float(s.median()),
            "min": float(s.min()),
            "max": float(s.max()),
        }
        print("[create_summary] Numeric: summary:", result)
        return result

    elif dtype == 'categorical':
        if gdf is None or column is None or column not in gdf.columns:
            result = {
                "count": 0,
                "categories": {},
            }
            print("[create_summary] Categorical: gdf/column invalid, returning:", result)
            return result

        s = gdf[column].dropna()
        if s.empty:
            result = {
                "count": 0,
                "categories": {},
            }
            print("[create_summary] Categorical: empty series, returning:", result)
            return result

        category_counts = s.value_counts().to_dict()
        result = {
            "data": column,
            "scale of analysis": scale,
            "region": region,
            "count": int(s.count()),
            "categories": category_counts,
        }
        print("[create_summary] Categorical: summary:", result)
        return result

    else:
        result = {
            "count": 0,
        }
        print("[create_summary] Unsupported dtype, returning:", result)
        return result


def run_analyze(query: str, history: Optional[List[Dict[str, str]]] = None):
    print("[run_analyze] Incoming query:", query)

    if history:
        print("[run_analyze] History provided with", len(history), "messages")
        history_parts = []
        for m in history:
            role = m.get("role", "")
            content = m.get("content", "")
            if not content:
                continue
            if role == "user":
                prefix = "User: "
            elif role == "assistant":
                prefix = "Assistant: "
            else:
                prefix = ""
            history_parts.append(prefix + content)
        history_text = "\n\n".join(history_parts)
        combined_query = f"Previous conversation:\n{history_text}\n\nNew query:\n{query}"
    else:
        print("[run_analyze] No history")
        combined_query = query

    print("[run_analyze] Combined query ready")
    messages = build_analyze_plan(combined_query)
    print("[run_analyze] Messages for plan built")

    plan, usage, plan_error = call_llm(messages)
    print("[run_analyze] Plan received. error:", plan_error, "usage:", usage)

    if plan_error or not plan:
        print("[run_analyze] Plan error or empty plan, returning fallback")
        return {
            "geojson": None,
            "column": None,
            "dtype": None,
            "scale": None,
            "region": None,
            "table": None,
            "filters": None,
            "summary": None,
            "explanation": None,
            "usage": usage,
            "error": plan_error or "LLM_PLAN_ERROR",
        }

    column = plan.get("column")
    dtype = plan.get("dtype")
    scale = plan.get("scale")
    region = plan.get("region")
    table = plan.get("table")
    filters = plan.get("filters") or []

    if scale == 'large_n' and column in ('crime_count', 'crime_per_pop'):
        scale = 'borough'
        table = 'street_block'
        filters = keep_only_region_filter(filters)
    
    if column == 'elevator':
        filters = keep_only_region_filter(filters)

    print("[run_analyze] Plan parsed:",
        "column:", column,
        "dtype:", dtype,
        "scale:", scale,
        "region:", region,
        "table:", table,
        "filters:", filters)

    db_result = get_data_analyze(column=column, scale=scale, table=table, filters=filters)
    gdf = db_result["gdf"]
    db_error = db_result["error"]
    print("[run_analyze] DB result. error:", db_error, "gdf is None:", gdf is None)

    summary = create_summary(gdf=gdf, column=column, scale=scale, region=region, dtype=dtype)
    print("[run_analyze] Summary created")

    try:
        explanation = llm_explain(query=query, summary=summary)
        print("[run_analyze] Explanation created")
    except Exception as e:
        print("[run_analyze] llm_explain crashed:", e)
        traceback.print_exc()
        explanation = f"[llm_explain error: {e}]"

    if gdf is not None:
        geojson = json.loads(gdf.to_json())
        print("[run_analyze] GeoJSON created with", len(geojson.get("features", [])), "features")
    else:
        geojson = None
        print("[run_analyze] GeoJSON is None (no gdf)")

    print("[run_analyze] Usage:", usage)
    return {
        "mode": "analyze",
        "geojson": geojson,
        "column": column,
        "dtype": dtype,
        "scale": scale,
        "region": region,
        "table": table,
        "filters": filters,
        "summary": summary,
        "explanation": explanation,
        "usage": usage,
        "error": db_error,
    }


def run_search(query: str, history: Optional[List[Dict[str, str]]] = None):
    print("[run_search] Incoming query:", query)

    if history:
        print("[run_search] History provided with", len(history), "messages")
        history_parts = []
        for m in history:
            role = m.get("role", "")
            content = m.get("content", "")
            if not content:
                continue
            if role == "user":
                prefix = "User: "
            elif role == "assistant":
                prefix = "Assistant: "
            else:
                prefix = ""
            history_parts.append(prefix + content)
        history_text = "\n\n".join(history_parts)
        combined_query = f"Previous conversation:\n{history_text}\n\nNew query:\n{query}"
    else:
        print("[run_search] No history")
        combined_query = query

    print("[run_search] Combined query ready")
    messages = build_search_plan(combined_query)
    print("[run_search] Messages for plan built")

    plan, usage, plan_error = call_llm(messages)
    print("[run_search] Plan received. error:", plan_error, "usage:", usage)

    if plan_error or not plan:
        print("[run_search] Plan error or empty plan, returning fallback")
        return {
            "geojson": None,
            "column": None,
            "summary": None,
            "analysis": None,
            "order": None,
            "explanation": None,
            "usage": usage,
            "error": plan_error or "LLM_PLAN_ERROR",
        }

    if isinstance(plan, str):
        print("[run_search] Plan is string, attempting json.loads")
        try:
            plan = json.loads(plan)
        except Exception as e:
            print("[run_search] PLAN_JSON_ERROR:", e)
            return {
                "geojson": None,
                "column": None,
                "summary": None,
                "analysis": None,
                "order": None,
                "explanation": None,
                "usage": usage,
                "error": f"PLAN_JSON_ERROR: {e}",
            }

    column_s = plan.get("column_s")
    column_b = plan.get("column_b")
    dtype_s = plan.get("dtype_s")
    dtype_b = plan.get("dtype_b")
    scale = plan.get("scale") or "large_n"
    analysis = plan.get("analysis")
    order = plan.get("order")
    region = plan.get("region")
    filters = plan.get("filters") or []

    print("[run_search] Plan parsed:",
        "column_s:", column_s,
        "column_b:", column_b,
        "dtype_s:", dtype_s,
        "dtype_b:", dtype_b,
        "scale:", scale,
        "analysis:", analysis,
        "order:", order,
        "region:", region,
        "filters:", filters)

    if not column_s or not analysis:
        print("[run_search] Missing column_s or analysis, returning error")
        return {
            "geojson": None,
            "column_s": column_s,
            "summary": None,
            "analysis": analysis,
            "order": order,
            "explanation": None,
            "usage": usage,
            "error": "MISSING_PLAN_FIELDS",
        }

    db_result = get_data_search(column=column_s)
    gdf = db_result["gdf"]
    db_error = db_result["error"]
    print("[run_search] DB result. error:", db_error, "gdf is None:", gdf is None)

    if db_error or gdf is None or gdf.empty:
        print("[run_search] DB error or no data, returning")
        return {
            "geojson": None,
            "column_s": column_s,
            "dtype_s": dtype_s,
            "dtype_b": dtype_b,
            "scale": scale,
            "summary": None,
            "explanation": None,
            "usage": usage,
            "error": db_error or "NO_DATA",
        }

    if scale == "large_n":
        group_col = "large_n"
    elif scale == "borough":
        group_col = "borocode"
    else:
        group_col = "large_n"
    print("[run_search] Group column:", group_col)

    if analysis == "mean":
        agg_func = "mean"
    elif analysis == "median":
        agg_func = "median"
    elif analysis == "min":
        agg_func = "min"
    elif analysis == "max":
        agg_func = "max"
    else:
        agg_func = "mean"
    print("[run_search] Aggregation function:", agg_func)

    grouped = getattr(gdf.groupby(group_col, dropna=False)[column_s], agg_func)().reset_index(name="metric")
    print("[run_search] Grouped rows:", len(grouped))

    if grouped.empty:
        print("[run_search] Grouped data empty, returning")
        return {
            "geojson": None,
            "column_s": column_s,
            "dtype_s": dtype_s,
            "dtype_b": dtype_b,
            "scale": scale,
            "summary": None,
            "explanation": None,
            "usage": usage,
            "error": "NO_GROUPED_DATA",
        }

    if not order or order == "NO_MATCH":
        order = "descending"
    ascending = str(order).lower().startswith("asc")
    print("[run_search] Order:", order, "ascending:", ascending)

    gdf_analyze = grouped.sort_values("metric", ascending=ascending)
    neighborhood = gdf_analyze.iloc[0][group_col]
    print("[run_search] Selected neighborhood:", neighborhood)

    if scale == "borough":
        db_final = get_data_search_final(column=column_s, scale=scale, neighborhood=neighborhood)
    elif scale == "large_n":
        db_final = get_data_search_final(column=column_b, scale=scale, neighborhood=neighborhood)
    else:
        db_final = get_data_search_final(column=column_s, scale=scale, neighborhood=neighborhood)
    gdf_final = db_final["gdf"]
    db_final_error = db_final["error"]
    print("[run_search] Final DB result. error:", db_final_error, "gdf_final is None:", gdf_final is None)

    if db_final_error or gdf_final is None or gdf_final.empty:
        print("[run_search] Final DB error or no data, returning")
        return {
            "geojson": None,
            "column": column_s if scale == "borough" else column_b,
            "dtype": dtype_s if scale == "borough" else dtype_b,
            "scale": scale,
            "summary": None,
            "explanation": None,
            "usage": usage,
            "error": db_final_error or "NO_FINAL_DATA",
        }
    if scale == "borough":
        summary = create_summary(gdf=gdf_final, column=column_s if scale == "borough" else column_b,
                            scale=scale, region=neighborhood, dtype=dtype_s)
    elif scale == "large_n":
        summary = create_summary(gdf=gdf_final, column=column_s if scale == "borough" else column_b,
                            scale=scale, region=neighborhood, dtype=dtype_b)
    print("[run_search] Summary created")

    try:
        explanation = llm_explain(query=query, summary=summary)
        print("[run_search] Explanation created")
    except Exception as e:
        print("[run_search] llm_explain crashed:", e)
        traceback.print_exc()
        explanation = f"[llm_explain error: {e}]"

    geojson = json.loads(gdf_final.to_json())
    print("[run_search] GeoJSON created with", len(geojson.get("features", [])), "features")

    print("[run_search] Usage:", usage)
    return {
        "mode": "search",
        "geojson": geojson,
        "column": column_s if scale == "borough" else column_b,
        "dtype": dtype_s if scale == "borough" else dtype_b,
        "scale": scale,
        "region": None,
        "table": None,
        "filters": None,
        "summary": summary,
        "explanation": explanation,
        "usage": usage,
        "error": db_final_error,
    }


def run_compare(query: str, history: Optional[List[Dict[str, str]]] = None):
    print("[run_compare] Incoming query:", query)

    if history:
        print("[run_compare] History provided with", len(history), "messages")
        history_parts = []
        for m in history:
            role = m.get("role", "")
            content = m.get("content", "")
            if not content:
                continue
            if role == "user":
                prefix = "User: "
            elif role == "assistant":
                prefix = "Assistant: "
            else:
                prefix = ""
            history_parts.append(prefix + content)
        history_text = "\n\n".join(history_parts)
        combined_query = f"Previous conversation:\n{history_text}\n\nNew query:\n{query}"
    else:
        print("[run_compare] No history")
        combined_query = query

    print("[run_compare] Combined query ready")
    messages = build_compare_plan(combined_query)
    print("[run_compare] Messages for plan built")

    plan, usage, plan_error = call_llm(messages)
    print("[run_compare] Plan received. error:", plan_error, "usage:", usage)

    if plan_error or not plan:
        print("[run_compare] Plan error or empty plan, returning fallback")
        return {
            "mode": "compare",
            "geojson": [None, None],
            "column": None,
            "dtype": None,
            "scale": None,
            "region": [None, None],
            "table": None,
            "filters": None,
            "summary": [None, None],
            "explanation": [None, None],
            "usage": usage,
            "error": plan_error or "LLM_PLAN_ERROR",
        }

    column = plan.get("column")
    region1 = plan.get("region1")
    region2 = plan.get("region2")
    dtype = plan.get("dtype")
    scale = plan.get("scale")
    table = plan.get("table")
    filters = plan.get("filters") or []

    print("[run_compare] Plan parsed:",
        "column:", column,
        "dtype:", dtype,
        "scale:", scale,
        "region1:", region1,
        "region2:", region2,
        "table:", table,
        "filters:", filters)

    db_result = get_data_compare(
        column=column,
        scale=scale,
        table=table,
        region1=region1,
        region2=region2,
        filters=filters,
    )
    gdf = db_result["gdf"]
    db_error = db_result["error"]
    print("[run_compare] DB result. error:", db_error, "gdf is None:", gdf is None)

    if db_error or gdf is None:
        print("[run_compare] DB error or gdf is None, returning")
        return {
            "mode": "compare",
            "geojson": [None, None],
            "column": column,
            "dtype": dtype,
            "scale": scale,
            "region": [region1, region2],
            "table": table,
            "filters": filters,
            "summary": [None, None],
            "explanation": [None, None],
            "usage": usage,
            "error": db_error or "DB_ERROR",
        }

    if scale == "borough":
        gdf1 = gdf[gdf["borocode"] == region1]
        gdf2 = gdf[gdf["borocode"] == region2]
    elif scale == "large_n":
        gdf1 = gdf[gdf["large_n"] == region1]
        gdf2 = gdf[gdf["large_n"] == region2]
    else:
        print("[run_compare] Invalid scale:", scale)
        return {
            "mode": "compare",
            "geojson": [None, None],
            "column": column,
            "dtype": dtype,
            "scale": scale,
            "region": [region1, region2],
            "table": table,
            "filters": filters,
            "summary": [None, None],
            "explanation": [None, None],
            "usage": usage,
            "error": f"INVALID_SCALE_{scale}",
        }

    print("[run_compare] gdf1 rows:", len(gdf1), "gdf2 rows:", len(gdf2))

    summary1 = create_summary(gdf=gdf1, column=column, scale=scale, region=region1, dtype=dtype)
    summary2 = create_summary(gdf=gdf2, column=column, scale=scale, region=region2, dtype=dtype)
    print("[run_compare] Summaries created for both regions")

    combined_summary = {
        "region1": summary1,
        "region2": summary2,
    }

    try:
        explanation = llm_explain(query=query, summary=combined_summary)
        print("[run_compare] Explanation created for both regions")
    except Exception as e:
        print("[run_compare] llm_explain crashed:", e)
        traceback.print_exc()
        explanation = f"[llm_explain error: {e}]"

    geojson0 = json.loads(gdf.to_json()) if gdf is not None else None
    geojson1 = json.loads(gdf1.to_json()) if gdf1 is not None else None
    geojson2 = json.loads(gdf2.to_json()) if gdf2 is not None else None
    print("[run_compare] GeoJSON created. total:",
        len(geojson0.get("features", [])) if geojson0 else 0,
        "region1:",
        len(geojson1.get("features", [])) if geojson1 else 0,
        "region2:",
        len(geojson2.get("features", [])) if geojson2 else 0)

    print("[run_compare] Usage:", usage)
    return {
        "mode": "compare",
        "geojson": [geojson0, geojson1, geojson2],
        "column": column,
        "dtype": dtype,
        "scale": scale,
        "region": [region1, region2],
        "table": table,
        "filters": filters,
        "summary": [summary1, summary2],
        "explanation": explanation,
        "usage": usage,
        "error": db_error,
    }


def run(query: str, history: Optional[List[Dict[str, str]]] = None):
    print("[run] Top-level run called with query:", query)
    try:
        messages = select_mode(query)
        print("[run] Mode selection messages built")

        mode_json, usage_mode, mode_error = call_llm(messages)
        print("[run] Mode selection result. error:", mode_error, "usage:", usage_mode, "mode_json:", mode_json)

        if mode_error or not mode_json:
            print("[run] Mode error or empty mode_json, returning fallback")
            return {
                "mode": None,
                "geojson": None,
                "column": None,
                "dtype": None,
                "scale": None,
                "region": None,
                "table": None,
                "filters": None,
                "summary": None,
                "explanation": None,
                "usage": usage_mode,
                "error": mode_error or "LLM_MODE_ERROR",
            }

        mode = mode_json.get("mode")
        print("[run] Selected mode:", mode)

        if mode == "analyze":
            result = run_analyze(query, history)
        elif mode == "search":
            result = run_search(query, history)
        elif mode == "compare":
            result = run_compare(query, history)
        else:
            print("[run] Mode not implemented:", mode)
            return {
                "mode": None,
                "geojson": None,
                "column": None,
                "dtype": None,
                "scale": None,
                "region": None,
                "table": None,
                "filters": None,
                "summary": None,
                "explanation": None,
                "usage": usage_mode,
                "error": f"mode '{mode}' not implemented",
            }

        print("[run] Sub-mode result received, attaching mode and mode_usage")
        result["mode"] = mode
        result["mode_usage"] = usage_mode
        return result

    except Exception as e:
        print("[run] Exception in top-level run:", e)
        traceback.print_exc()
        return {
            "mode": None,
            "geojson": None,
            "column": None,
            "dtype": None,
            "scale": None,
            "region": None,
            "table": None,
            "filters": None,
            "summary": None,
            "explanation": None,
            "usage": None,
            "error": f"internal server error: {e}",
        }