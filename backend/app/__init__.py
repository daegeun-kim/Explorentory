from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .modes.services import run
from typing import Optional,List,Dict

class QueryPayload(BaseModel):
    query: str
    history: Optional[List[Dict[str, str]]] = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze")
def analyze(payload: QueryPayload):
    result = run(payload.query, payload.history)
    return {
        "mode": result['mode'],
        "geojson": result['geojson'],
        "column": result['column'],
        "dtype": result['dtype'],
        "scale": result['scale'],
        "region": result['region'],
        "table": result['table'],
        "filters": result['filters'],
        "summary": result['summary'],
        "explanation": result['explanation'],
        "usage": result['usage'],
        "error": result['error'],
    }

