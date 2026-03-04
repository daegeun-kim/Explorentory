import pandas as pd
from sqlalchemy import create_engine
from dotenv import load_dotenv
import os
import geopandas as gpd

load_dotenv(dotenv_path="../.env")

DB_URL = os.getenv("db_url")
engine = create_engine(DB_URL)

def get_data_analyze(column, scale, table, filters):
    if not column:
        print("no column matched")
        return {"gdf": None, "error": "no appropriate column"}

    base_table = f"public.{table}"

    where_clauses = []
    params = {}

    if filters:
        for i, (col, op, val) in enumerate(filters):
            if val == "NO_MATCH":
                continue
            key = f"v{i}"
            where_clauses.append(f"{col} {op} %({key})s")
            params[key] = val

    where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

    if scale == "city":
        sql = f"SELECT {column}, borocode, geom FROM {base_table} WHERE {where_sql}"
    elif scale == "borough":
        sql = f"SELECT {column}, large_n, small_n, geom FROM {base_table} WHERE {where_sql}"
    elif scale == "large_n":
        sql = f"SELECT {column}, small_n, geom FROM {base_table} WHERE {where_sql}"
    print("sql:", sql, "params:", params)

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geom", params=params)
        print("data retrieved from db")
        return {"gdf": gdf, "error": None}
    except Exception as e:
        print("failed to retrieve data:", e)
        return {"gdf": None, "error": str(e)}




def get_data_search(column):
    if not column:
        print("no column matched")
        return {"gdf": None, "error": "no appropriate column"}

    sql = f"SELECT {column}, borocode, large_n, geom FROM public.street_block"
    print("column:", column)

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geom")
        print("data retrieved from db")
        return {"gdf": gdf, "error": None}
    except Exception as e:
        print("failed to retrieve data:", e)
        return {"gdf": None, "error": str(e)}

def get_data_search_final(column, scale, neighborhood):
    if not column:
        print("no column matched")
        return {"gdf": None, "error": "no appropriate column"}
    if not scale or neighborhood is None:
        print("missing scale or neighborhood")
        return {"gdf": None, "error": "missing scale or neighborhood"}
    
    if scale == "borough":
        neighborhood = int(neighborhood)

    params = None

    if scale == "large_n":
        sql = f"SELECT {column}, large_n, small_n, geom FROM public.buildings WHERE large_n = %s"
        params = (neighborhood,)
        print("column:", column, "scale:", scale, "neighborhood:", neighborhood)
    elif scale == "borough":
        sql = f"SELECT {column}, borocode, large_n, geom FROM public.street_block WHERE borocode = %s"
        params = (neighborhood,)
        print("column:", column, "scale:", scale, "neighborhood:", neighborhood)
    else:
        print("unsupported scale:", scale)
        return {"gdf": None, "error": f"unsupported scale: {scale}"}

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geom", params=params)
        print("data retrieved from db")
        return {"gdf": gdf, "error": None}
    except Exception as e:
        print("failed to retrieve data:", e)
        return {"gdf": None, "error": str(e)}
    


def get_data_compare(column, scale, table, region1, region2, filters):
    if not column or column == "NO_MATCH":
        print("no column matched")
        return {"gdf": None, "error": "no appropriate column"}

    base_table = f"public.{table}"
    params = {}

    if scale == "borough":
        region_clause = "borocode IN (%(r1)s, %(r2)s)"
        region = "borocode"
        params["r1"] = region1
        params["r2"] = region2
    elif scale == "large_n":
        region_clause = "large_n IN (%(r1)s, %(r2)s)"
        region = "large_n"
        params["r1"] = region1
        params["r2"] = region2
    else:
        print("invalid scale:", scale)
        return {"gdf": None, "error": f"invalid scale: {scale}"}

    where_parts = [region_clause]

    if filters:
        for i, (col, op, val) in enumerate(filters):
            if val == "NO_MATCH":
                continue
            key = f"v{i}"
            where_parts.append(f"{col} {op} %({key})s")
            params[key] = val

    where_sql = " AND ".join(where_parts)

    sql = f"SELECT {column}, {region}, geom FROM {base_table} WHERE {where_sql}"
    print("sql:", sql, "params:", params)

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geom", params=params)
        print("data retrieved from db")
        return {"gdf": gdf, "error": None}
    except Exception as e:
        print("failed to retrieve data:", e)
        return {"gdf": None, "error": str(e)}
