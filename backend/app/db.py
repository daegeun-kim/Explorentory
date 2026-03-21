import json
import math
import geopandas as gpd
from sqlalchemy import create_engine, text
from shapely.geometry import mapping
from dotenv import load_dotenv
import os
from typing import Optional

load_dotenv(dotenv_path="../.env")

DB_URL = os.getenv("db_url")
engine = create_engine(DB_URL)


# ---------------------------------------------------------------------------
# Neighborhoods
# ---------------------------------------------------------------------------

def get_neighborhoods():
    """Return all neighborhood polygons from the 'neighb' table as GeoJSON.
    Each feature includes centroid_lon and centroid_lat properties."""
    print("[db] querying neighb table for neighborhood geometries")
    sql = text("SELECT * FROM neighb")

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geom")
        print(f"[db] retrieved {len(gdf)} neighborhoods")

        if gdf.crs is None:
            print("[db] neighb CRS not set — assuming EPSG:2263, reprojecting to EPSG:4326")
            gdf = gdf.set_crs("EPSG:2263")
        gdf = gdf.to_crs("EPSG:4326")

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
):
    min_rent = rent * 0.5
    max_rent = rent * 1.2
    min_bed  = max(0, bedrooms - 1)
    max_bed  = bedrooms + 1
    min_bath = max(0, bathrooms - 1)
    max_bath = bathrooms + 1

    print(
        f"[db] querying nyc_units  rent=[{min_rent:.0f}, {max_rent:.0f}]"
        f"  bed=[{min_bed}, {max_bed}]  bath=[{min_bath}, {max_bath}]"
        f"  neighborhood_lon={neighborhood_lon}  neighborhood_lat={neighborhood_lat}"
    )

    sql = text("""
        SELECT * FROM nyc_units
        WHERE rent_knn  BETWEEN :min_rent AND :max_rent
        AND   bedroomnum  BETWEEN :min_bed  AND :max_bed
        AND   bathroomnum BETWEEN :min_bath AND :max_bath
    """)
    params = {
        "min_rent": min_rent, "max_rent": max_rent,
        "min_bed":  min_bed,  "max_bed":  max_bed,
        "min_bath": min_bath, "max_bath": max_bath,
    }

    try:
        gdf = gpd.read_postgis(sql, con=engine, geom_col="geometry", params=params)
        print(f"[db] retrieved {len(gdf)} rows from nyc_units")

        if gdf.empty:
            print("[db] no rows matched the filters")
            return {
                "gdf":    None,
                "sample": None,
                "error":  "No properties found matching your criteria. Try adjusting rent or bedroom/bathroom count.",
            }

        # Reproject to WGS84 for distance computation and frontend
        if gdf.crs is None:
            print("[db] CRS not set — assuming EPSG:2263, reprojecting to EPSG:4326")
            gdf = gdf.set_crs("EPSG:2263")
        gdf_4326 = gdf.to_crs("EPSG:4326")
        print("[db] reprojected to EPSG:4326")

        # Compute euclidean distance from neighborhood centroid to each property's first point
        if neighborhood_lon is not None and neighborhood_lat is not None:
            gdf_4326["distance"] = gdf_4326.geometry.apply(
                lambda g: _euclidean_dist(
                    _first_point(g),
                    (neighborhood_lon, neighborhood_lat)
                )
            )
            print(f"[db] computed distance column  min={gdf_4326['distance'].min():.6f}  max={gdf_4326['distance'].max():.6f}")
        else:
            print("[db] no neighborhood centroid provided — setting distance=0")
            gdf_4326["distance"] = 0.0

        # Transfer distance back to the raw-CRS gdf so recommend.py receives it
        gdf["distance"] = gdf_4326["distance"].values

        # Sample up to 10 properties for the rating step
        n_sample   = min(10, len(gdf_4326))
        sample_gdf = gdf_4326.sample(n=n_sample, random_state=42)
        print(f"[db] sampled {n_sample} properties for user rating")

        sample_list = []
        for _, row in sample_gdf.iterrows():
            geom      = row.geometry
            geom_dict = dict(mapping(geom))

            item = {
                "rent_knn":      _safe_float(row.get("rent_knn")),
                "sqft":          _safe_float(row.get("sqft")),
                "bedroomnum":    _safe_int(row.get("bedroomnum")),
                "bathroomnum":   _safe_int(row.get("bathroomnum")),
                "small_n":       str(row.get("small_n") or ""),
                "geom":          geom_dict,
                "livingroomnum": _safe_int(row.get("livingroomnum")),
                "borocode":      _safe_int(row.get("borocode")),
                "built_year":    _safe_int(row.get("built_year")),
                "bld_story":     _safe_int(row.get("bld_story")),
                "elevator":      bool(row.get("elevator") or False),
            }
            sample_list.append(item)

        print(f"[db] sample built — geometry type: {sample_list[0]['geom']['type'] if sample_list else 'n/a'}")
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
