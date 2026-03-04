DB_SCHEMA_analyze = """
db: PostgreSQL 16 + PostGIS

tables:
    buildings:
        spine: [borocode, large_n, small_n, shape_area, shape_leng, geom]
        cat: 
            zoning
            bldg_class
            elevator : True or False (boolean)
        num:
            built_year
            ground_ele : ground elevation (ft)
            heightroof
            bld_value_2025 : total building value (2025)
            bld_value_2024
            avg_prop_value_2025   : avg property value inside building (2025)
            avg_prop_value_2024
            value_sqft_2025
            value_sqft_2024
            gross_sqft
            res_gross_sqft
            bld_story
            crime_count
            crime_per_pop

    street_block:
        spine: [borocode, large_n, small_n, geom]
        cat: [ur20, zoning, bldg_class_dom]
        num:
            aland20 : land area
            awater20 : water area
            housing20 : total housing units
            pop20 : population
            built_year_avg
            ground_ele_avg
            height_avg            : avg building height (ft)
            ele_percent           : percent of buildings with elevator
            bld_val_2025_sum
            bld_val_2024_sum
            gross_sqft_sum
            res_gross_sqft_sum
            prop_val_2025_avg
            prop_val_2024_avg
            story_avg             : avg building stories
            val_sqft_2025_avg
            val_sqft_2024_avg

    regions:
    borocode: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island
    large_n_by_borocode:
        1: [way uptown manhattan, midtown manhattan, downtown manhattan, uptown manhattan]
        2: [central bronx, west bronx, east bronx, south bronx]
        3: [south brooklyn, north brooklyn, central brooklyn, east brooklyn]
        4: [northeast queens, western queens, southeast queens,
            rockaways queens, northwest queens, special queens, central queens]
        5: [south shore staten island, east shore staten island,
            mid staten island, north shore staten island]
    """