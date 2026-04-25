import json
import math
import time
import geopandas as gpd
import pandas as pd
from sqlalchemy import create_engine, text
from shapely.geometry import mapping
from dotenv import load_dotenv
import os
from typing import Optional

load_dotenv(dotenv_path="../.env")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Database tables
NEIGHBORHOODS_TABLE   = "neighb"
NEIGHBORHOODS_GEOM_COL = "geom"
PROPERTIES_TABLE      = "nyc_units"
PROPERTIES_GEOM_COL   = "geometry"

# Coordinate reference systems
DEFAULT_CRS = "EPSG:2263"   # assumed when CRS is missing
TARGET_CRS  = "EPSG:4326"   # WGS84 — required by the frontend

# Rent filter range around the user's target rent
RENT_MIN_FACTOR = 0.8   # min_rent = rent * RENT_MIN_FACTOR
RENT_MAX_FACTOR = 1.05   # max_rent = rent * RENT_MAX_FACTOR

# Bedroom / bathroom filter tolerance (±N)
BEDROOM_TOLERANCE  = 1
BATHROOM_TOLERANCE = 1

# Number of sample properties shown to the user for rating
SAMPLE_SIZE        = 10
SAMPLE_RANDOM_SEED = 42

# Minimum number of sample properties that must come from the same
# borocode as the user's selected neighborhood (rest filled randomly)
MIN_SAME_BORO_SAMPLES = 5

# ---------------------------------------------------------------------------

DB_URL = os.getenv("db_url")
engine = create_engine(DB_URL)


# ---------------------------------------------------------------------------
# Neighborhoods
# ---------------------------------------------------------------------------

def get_neighborhoods():
    """Return all neighborhood polygons from the neighborhoods table as GeoJSON.
    Each feature includes centroid_lon and centroid_lat properties."""
    print(f"[db] querying {NEIGHBORHOODS_TABLE} table for neighborhood geometries")
    sql = text(f"SELECT * FROM {NEIGHBORHOODS_TABLE}")

    try:
        _t0 = time.perf_counter()
        gdf = gpd.read_postgis(sql, con=engine, geom_col=NEIGHBORHOODS_GEOM_COL)
        print(f"[db] retrieved {len(gdf)} neighborhoods  ({time.perf_counter()-_t0:.3f}s)")

        if gdf.crs is None:
            print(f"[db] neighb CRS not set — assuming {DEFAULT_CRS}, reprojecting to {TARGET_CRS}")
            gdf = gdf.set_crs(DEFAULT_CRS)
        gdf = gdf.to_crs(TARGET_CRS)

        # Add centroid lon/lat as properties so the frontend can read them
        centroids = gdf.geometry.centroid
        gdf["centroid_lon"] = centroids.x
        gdf["centroid_lat"] = centroids.y
        print(f"[db] computed centroids for {len(gdf)} neighborhoods")

        geojson = json.loads(gdf.to_json())
        print(f"[db] neighborhoods serialized — {len(geojson.get('features', []))} features")
        return {"geojson": geojson, "error": None}

    except Exception as e:
        print(f"[db] get_neighborhoods exception: {e}")
        return {"geojson": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Filtered properties
# ---------------------------------------------------------------------------

def get_filtered_properties(
    rent: float,
    bedrooms: int,
    bathrooms: int,
    neighborhood_lon: Optional[float] = None,
    neighborhood_lat: Optional[float] = None,
    neighborhood_borocode: Optional[int] = None,
):
    min_rent = rent * RENT_MIN_FACTOR
    max_rent = rent * RENT_MAX_FACTOR
    min_bed  = max(0, bedrooms - BEDROOM_TOLERANCE)
    max_bed  = bedrooms + BEDROOM_TOLERANCE
    min_bath = max(0, bathrooms - BATHROOM_TOLERANCE)
    max_bath = bathrooms + BATHROOM_TOLERANCE

    print(
        f"[db] querying {PROPERTIES_TABLE}  rent=[{min_rent:.0f}, {max_rent:.0f}]"
        f"  bed=[{min_bed}, {max_bed}]  bath=[{min_bath}, {max_bath}]"
        f"  neighborhood_lon={neighborhood_lon}  neighborhood_lat={neighborhood_lat}"
    )

    sql = text(f"""
        SELECT * FROM {PROPERTIES_TABLE}
        WHERE rent_knn  BETWEEN :min_rent AND :max_rent
        AND   bedroomnum  BETWEEN :min_bed  AND :max_bed
        AND   bathroomnum BETWEEN :min_bath AND :max_bath
        ORDER BY RANDOM()
        LIMIT 200000
    """)
    params = {
        "min_rent": min_rent, "max_rent": max_rent,
        "min_bed":  min_bed,  "max_bed":  max_bed,
        "min_bath": min_bath, "max_bath": max_bath,
    }

    try:
        _t0 = time.perf_counter()
        gdf = gpd.read_postgis(sql, con=engine, geom_col=PROPERTIES_GEOM_COL, params=params)
        print(f"[db] retrieved {len(gdf)} rows from {PROPERTIES_TABLE}  ({time.perf_counter()-_t0:.3f}s)")

        if gdf.empty:
            print("[db] no rows matched the filters")
            return {
                "gdf":    None,
                "sample": None,
                "error":  "No properties found matching your criteria. Try adjusting rent or bedroom/bathroom count.",
            }

        # Reproject to WGS84 for distance computation and frontend
        if gdf.crs is None:
            print(f"[db] CRS not set — assuming {DEFAULT_CRS}, reprojecting to {TARGET_CRS}")
            gdf = gdf.set_crs(DEFAULT_CRS)
        gdf_4326 = gdf.to_crs(TARGET_CRS)
        print(f"[db] reprojected to {TARGET_CRS}")

        # Compute euclidean distance from neighborhood centroid to each property's first point
        if neighborhood_lon is not None and neighborhood_lat is not None:
            _td = time.perf_counter()
            gdf_4326["distance"] = gdf_4326.geometry.apply(
                lambda g: _euclidean_dist(
                    _first_point(g),
                    (neighborhood_lon, neighborhood_lat)
                )
            )
            print(f"[db] computed distance column  min={gdf_4326['distance'].min():.6f}  max={gdf_4326['distance'].max():.6f}  ({time.perf_counter()-_td:.3f}s)")
        else:
            print("[db] no neighborhood centroid provided — setting distance=0")
            gdf_4326["distance"] = 0.0

        # Transfer distance back to the raw-CRS gdf so recommend.py receives it
        gdf["distance"] = gdf_4326["distance"].values

        # Sample properties for the rating step.
        # If a borocode is provided, guarantee at least MIN_SAME_BORO_SAMPLES
        # from the same borough; fill remaining slots from other properties.
        if neighborhood_borocode is not None:
            same_boro = gdf_4326[
                gdf_4326["borocode"].apply(_safe_int) == int(neighborhood_borocode)
            ]
            other = gdf_4326[
                gdf_4326["borocode"].apply(_safe_int) != int(neighborhood_borocode)
            ]
            n_boro  = min(MIN_SAME_BORO_SAMPLES, len(same_boro))
            n_other = min(SAMPLE_SIZE - n_boro, len(other))
            parts = []
            if n_boro > 0:
                parts.append(same_boro.sample(n=n_boro, random_state=SAMPLE_RANDOM_SEED))
            if n_other > 0:
                parts.append(other.sample(n=n_other, random_state=SAMPLE_RANDOM_SEED))
            sample_gdf = pd.concat(parts) if parts else gdf_4326.iloc[:0]
            print(
                f"[db] sampled {len(sample_gdf)} properties for user rating"
                f"  ({n_boro} from borocode={neighborhood_borocode}, {n_other} from others)"
            )
        else:
            n_sample   = min(SAMPLE_SIZE, len(gdf_4326))
            sample_gdf = gdf_4326.sample(n=n_sample, random_state=SAMPLE_RANDOM_SEED)
            print(f"[db] sampled {n_sample} properties for user rating (random, no borocode)")

        sample_list = []
        for _, row in sample_gdf.iterrows():
            geom      = row.geometry
            geom_dict = dict(mapping(geom))

            item = {
                "rent_knn":           _safe_float(row.get("rent_knn")),
                "sqft":               _safe_float(row.get("sqft")),
                "bedroomnum":         _safe_int(row.get("bedroomnum")),
                "bathroomnum":        _safe_int(row.get("bathroomnum")),
                "small_n":            str(row.get("small_n") or ""),
                "geom":               geom_dict,
                "livingroomnum":      _safe_int(row.get("livingroomnum")),
                "borocode":           _safe_int(row.get("borocode")),
                "built_year":         _safe_int(row.get("built_year")),
                "bld_story":          _safe_int(row.get("bld_story")),
                "elevator":           bool(row.get("elevator") or False),
                "dist_greenspace_ft": _safe_float(row.get("dist_greenspace_ft")),
                "dist_subway_ft":     _safe_float(row.get("dist_subway_ft")),
                "noise_level":        str(row.get("noise_level") or ""),
                "nearest_major_park": str(row.get("nearest_major_park") or ""),
                "dist_major_park_ft": _safe_float(row.get("dist_major_park_ft")),
            }
            sample_list.append(item)

        print(f"[db] sample built — geometry type: {sample_list[0]['geom']['type'] if sample_list else 'n/a'}")
        print(f"[db] get_filtered_properties total: {time.perf_counter()-_t0:.3f}s")
        return {"gdf": gdf, "sample": sample_list, "error": None}

    except Exception as e:
        print(f"[db] exception: {e}")
        return {"gdf": None, "sample": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _first_point(geom):
    """Return (lon, lat) of the first coordinate of a shapely geometry."""
    if geom is None:
        return (0.0, 0.0)
    gtype = geom.geom_type
    if gtype == "Point":
        return (geom.x, geom.y)
    elif gtype in ("Polygon", "LinearRing"):
        coords = list(geom.exterior.coords)
        return (coords[0][0], coords[0][1]) if coords else (0.0, 0.0)
    elif gtype == "MultiPolygon":
        first_poly = list(geom.geoms)[0]
        coords = list(first_poly.exterior.coords)
        return (coords[0][0], coords[0][1]) if coords else (0.0, 0.0)
    elif gtype in ("LineString",):
        coords = list(geom.coords)
        return (coords[0][0], coords[0][1]) if coords else (0.0, 0.0)
    elif gtype == "MultiPoint":
        return (list(geom.geoms)[0].x, list(geom.geoms)[0].y)
    else:
        return (geom.centroid.x, geom.centroid.y)


def _euclidean_dist(p1, p2):
    """Euclidean distance between two (lon, lat) points."""
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def _safe_float(val):
    try:
        return float(val) if val is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _safe_int(val):
    try:
        return int(val) if val is not None else 0
    except (TypeError, ValueError):
        return 0
