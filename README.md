# Explorentory — AI-Powered Rental Discovery Through Trade-Off Intelligence

## Rethinking Rental Search

Most real estate platforms rely on rigid filters:
- Rent < $3000
- 2 bedrooms
- Within a neighborhood

This creates a **binary experience**:
- Properties either match or disappear
- No understanding of trade-offs (e.g., cheaper but farther, bigger but older)

**Explorentory replaces filtering with optimization.**

It enables users to:
- Explore **trade-offs between rent, location, and space**
- Learn their own preferences through interaction
- Receive **ranked, personalized recommendations**

This project is a **full-stack, data-driven system** integrating:
- Geospatial data
- Synthetic data generation
- Machine learning
- Interactive UI/UX

It is built as a **vertical slice MVP** — a complete, working system that reflects the final product experience.

---

## What Makes This Different

- **Not filter-based → score-based**
- **Not static → adaptive (learns from user feedback)**
- **Not purely ML → hybrid (rules + ML)**
- **Not just data → full user experience pipeline**

---

## System Overview

User Input → Filtering → Geospatial Analysis → Scoring → ML Personalization → Ranked Output

---

## End-to-End Workflow

### 1. Data Pipeline

#### 1.1 Manual Data Collection (Seed Dataset)

To bootstrap the system:

- Manually scraped properties with:
  - `bin`, `rent`, `sqft`, `type`
  - `bedroomnum`, `bathroomnum`

Sampling strategy:
- Cover full price spectrum (cheap → luxury)
- Cover full geography (urban → suburban)

---

#### 1.2 Property Dataset Construction

Base schema:

['bin', 'rent', 'sqft', 'livingroomnum', 'bedroomnum', 'bathroomnum',
'borocode', 'geom', 'built_year', 'heightroof', 'small_n', 'large_n',
'elevator', 'bld_story', 'zoning', 'bldg_class', 'res_gross_sqft']

- Sources: NYC PLUTO + building footprints
- Scale: ~3,000,000 synthetic unit-level records

---

#### 1.3 Building Type Classification

lowrise : bld_story ≤ 4 OR no elevator
midrise : 5 ≤ bld_story ≤ 12 AND elevator
highrise : bld_story ≥ 13

---

#### 1.4 Synthetic Unit Generation

Minimum size: **160 sqft**

Example distributions:

- Probabilistic assignment of unit types
- Ensures realistic housing stock distribution

lowrise:
[('studio', 0.08, 160–450),
('1br', 0.42, 450–700),
('2br', 0.32, 650–1500),
('3br', 0.15, 900–2500),
('4br', 0.03, 1300–5000)]

---

## Machine Learning — Rent Estimation

### Problem

- Only ~105 units have real rent values
- Dataset size: ~3M units

→ Highly sparse supervision

---

### Solution

X:
['multiplier', 'sqft', 'livingroomnum', 'bedroomnum', 'bathroomnum',
'built_year', 'elevator', 'bld_story', 'bldg_class', 'bld_type']

y:
['rent']


---

### Neighborhood Multiplier

Encodes location value:

Tribeca-Civic Center → 2.10
Soundview-Clason Point → 0.80

Implementation:

units_df ← merge(neighborhood, on='small_n')


---


Expected behavior:
- Strong influence: `multiplier`, `sqft`
- Secondary influence: building attributes

---

### Important Note

This is **not a predictive model**.

It is a **data completion model**:
- Generates reasonable rent estimates
- Enables downstream ranking and filtering

---

## Application Flow

### 2. User Survey

User inputs:
- Desired rent
- Bedrooms
- Bathrooms

Filtering:
- Rent: -20% to +5%
- Bedrooms: ±1
- Bathrooms: ±1

---

### 3. Neighborhood Selection

- User selects preferred neighborhood
- Compute:

distance = dist(property_geom, neighborhood_centroid)


---

### 4. Rule-Based Scoring

Features:
- Rent
- Distance
- Sqft

Each normalized to [0, 1]

Weighted priority:
- 1st → ×3
- 2nd → ×2
- 3rd → ×1

---

### 5. Preference Learning (ML Layer)

Process:
1. Show 10 properties
2. User rates (0–10)

Training data:

X:
[rent, sqft,
bedroom_diff,
bathroom_diff,
borocode_match,
built_year_diff,
bld_story_diff]

y:
[user rating]


---

### 6. Hybrid Scoring

final_score = (ML_score + rule_score) / 2


- Rule-based = explicit preferences
- ML = learned preferences

---

### 7. Final Output

- Ranked property list
- Trade-off-aware recommendations
- Geospatial visualization

---

## Vertical Slice MVP Characteristics

### End-to-End Functionality

- Fully connected system:
  - UI → backend → ML → visualization
- No mocked components

---

### Representative of Final Product

- Real datasets (PLUTO, geospatial)
- Real ML models
- Real user interaction flow

---

### Cross-Disciplinary Integration

- Data Engineering (3M dataset generation)
- Machine Learning (regression + preference learning)
- Geospatial Analysis (distance, neighborhoods)
- Backend (FastAPI, PostgreSQL/PostGIS)
- Frontend (interactive UI + maps)

---

### Validation

Tests:
- Do users prefer ranking over filtering?
- Do trade-offs improve decision making?
- Does small ML feedback improve recommendations?

---

### Risk Reduction

Identified challenges:
- Sparse rent labels
- Frontend rendering performance
- ML overfitting (small sample size)
- SQL vs in-memory bottlenecks

Mitigations:
- SQL-level filtering (3M → ~1K rows)
- Log-transform regression
- Hybrid scoring system

---

## Key Design Insights

### 1. Rent is Location-Dominated

→ Introduced **neighborhood multiplier**

---

### 2. Filtering is Too Rigid

→ Replaced with **continuous scoring**

---

### 3. ML Alone is Not Enough

→ Combined with **rule-based system**

---

### Core Principle

> Replace hard constraints with weighted optimization + user-driven learning

---

## Tech Stack

- **Backend**: Python, FastAPI
- **Database**: PostgreSQL + PostGIS
- **ML**: scikit-learn (OLS regression)
- **Geospatial**: GeoPandas, Shapely
- **Frontend**: Map-based interactive UI (Mapbox / WebGL)
- **Data Sources**: NYC PLUTO, building footprints

---

## Future Improvements

- Expand real rent dataset (scraping / APIs)
- Upgrade model:
  - Gradient boosting
  - Spatial ML models
- Improve location encoding (lat/lon embeddings)
- Optimize frontend rendering (vector tiles)
- Introduce GNN-based spatial reasoning

---

## Conclusion

Explorentory is a **data + ML + geospatial system** that transforms rental search into a **decision-making process**.

It demonstrates:
- A scalable data pipeline
- A hybrid ML architecture
- A user-centric ranking system

Most importantly, it proves that:

> Rental search should not be about filtering options —  
> it should be about understanding trade-offs.
