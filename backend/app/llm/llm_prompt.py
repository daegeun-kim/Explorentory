DB_SCHEMA_analyze = """
db: PostgreSQL 16 + PostGIS

table:
    nyc_units:
        key: bin
        cat: 
            borocode
            elevator               : boolean for elevator existence
            zoning
            bld_type
        num:
            rent_knn
            sqft
            livingroomnum
            bedroomnum
            bathroomnum
            built_year
            heightroof
            small_n                : small scale neighborhood
            large_n                : large scale neighborhood (district)
            bld_story
    """