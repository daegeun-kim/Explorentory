from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from .db import get_filtered_properties, get_neighborhoods
from .recommend import run_recommendation
from .llm.llm_router import explain_property, explain_result, chat_query

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Preferences(BaseModel):
    rent: float
    bedrooms: int
    bathrooms: int
    neighborhood_lon: Optional[float] = None
    neighborhood_lat: Optional[float] = None
    neighborhood_borocode: Optional[int] = None
    priority_order: Optional[List[str]] = None


class RatedProperty(BaseModel):
    features: Dict[str, Any]
    rating: int


class RecommendPayload(BaseModel):
    preferences: Preferences
    ratings: List[RatedProperty]


class ExplainPayload(BaseModel):
    user_prefs: Dict[str, Any]
    property_info: Dict[str, Any]


class ExplainResultPayload(BaseModel):
    user_prefs: Dict[str, Any]
    priority_order: List[str]
    ols_coef: Dict[str, float]
    neighborhood: Optional[str] = ""
    concern: Optional[str] = ""
    result_summary: Optional[Dict[str, Any]] = None


class ChatPayload(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = []
    properties: Optional[List[Dict[str, Any]]] = []


@app.post("/explain")
def get_explanation(payload: ExplainPayload):
    print(f"\n[API] POST /explain  concern='{payload.user_prefs.get('concern', '')[:60]}'")
    try:
        text = explain_property(payload.user_prefs, payload.property_info)
        print(f"[API] /explain done ({len(text)} chars)")
        return {"explanation": text, "error": None}
    except Exception as e:
        print(f"[API] /explain error: {e}")
        return {"explanation": None, "error": str(e)}


@app.get("/neighborhoods")
def fetch_neighborhoods():
    print("\n[API] GET /neighborhoods")
    result = get_neighborhoods()
    if result["error"]:
        print(f"[API] /neighborhoods error: {result['error']}")
        return {"error": result["error"], "geojson": None}
    count = len(result["geojson"].get("features", []))
    print(f"[API] /neighborhoods returning {count} neighborhood polygons")
    return {"geojson": result["geojson"], "error": None}


@app.post("/properties")
def get_properties(prefs: Preferences):
    print(
        f"\n[API] POST /properties  rent={prefs.rent}  bed={prefs.bedrooms}"
        f"  bath={prefs.bathrooms}  neighborhood_lon={prefs.neighborhood_lon}"
        f"  neighborhood_lat={prefs.neighborhood_lat}  neighborhood_borocode={prefs.neighborhood_borocode}"
    )
    result = get_filtered_properties(
        prefs.rent,
        prefs.bedrooms,
        prefs.bathrooms,
        prefs.neighborhood_lon,
        prefs.neighborhood_lat,
        prefs.neighborhood_borocode,
    )
    if result["error"]:
        print(f"[API] /properties error: {result['error']}")
        return {"error": result["error"], "sample": None}
    print(f"[API] /properties returning {len(result['sample'])} sample properties")
    return {"sample": result["sample"], "error": None}


@app.post("/recommend")
def get_recommendations(payload: RecommendPayload):
    prefs = payload.preferences
    print(
        f"\n[API] POST /recommend  rent={prefs.rent}"
        f"  bed={prefs.bedrooms}  bath={prefs.bathrooms}"
        f"  neighborhood_lon={prefs.neighborhood_lon}  neighborhood_lat={prefs.neighborhood_lat}"
        f"  neighborhood_borocode={prefs.neighborhood_borocode}"
        f"  priority_order={prefs.priority_order}  ratings={len(payload.ratings)}"
    )
    result = get_filtered_properties(
        prefs.rent,
        prefs.bedrooms,
        prefs.bathrooms,
        prefs.neighborhood_lon,
        prefs.neighborhood_lat,
        prefs.neighborhood_borocode,
    )
    if result["error"]:
        print(f"[API] /recommend db error: {result['error']}")
        return {"error": result["error"], "geojson": None}

    user_prefs = {
        "bedrooms":             prefs.bedrooms,
        "bathrooms":            prefs.bathrooms,
        "neighborhood_borocode": prefs.neighborhood_borocode,
    }
    print(f"[API] /recommend full dataset: {len(result['gdf'])} properties -> running recommendation")
    rec = run_recommendation(result["gdf"], payload.ratings, prefs.priority_order, user_prefs)
    if rec["error"]:
        print(f"[API] /recommend model error: {rec['error']}")
        return {"error": rec["error"], "geojson": None}

    count = len(rec["geojson"].get("features", []))
    print(f"[API] /recommend done -> returning {count} recommendations")
    return {"geojson": rec["geojson"], "ols_coef": rec.get("ols_coef", {}), "error": None}


@app.post("/explain_result")
def get_result_explanation(payload: ExplainResultPayload):
    print(f"\n[API] POST /explain_result  priority={payload.priority_order}")
    try:
        text = explain_result(
            payload.user_prefs,
            payload.priority_order,
            payload.ols_coef,
            payload.neighborhood,
            payload.concern,
            payload.result_summary,
        )
        print(f"[API] /explain_result done ({len(text)} chars)")
        return {"explanation": text, "error": None}
    except Exception as e:
        print(f"[API] /explain_result error: {e}")
        return {"explanation": None, "error": str(e)}


@app.post("/chat")
def chat_with_llm(payload: ChatPayload):
    print(f"\n[API] POST /chat  message='{payload.message[:80]}'")
    try:
        result = chat_query(payload.message, payload.history or [], payload.properties or [])
        print(f"[API] /chat done  keys={list(result.keys())}")
        return {"result": result, "error": None}
    except Exception as e:
        print(f"[API] /chat error: {e}")
        return {"result": None, "error": str(e)}
