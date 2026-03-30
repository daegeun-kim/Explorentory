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

- Sources: NYC PLUTO + building footprints
- Scale: ~3,000,000 synthetic unit-level records

---

#### 1.3 Building Type Classification

---

#### 1.4 Synthetic Unit Generation

Minimum size: **160 sqft**

Example distributions:

- Probabilistic assignment of unit types
- Ensures realistic housing stock distribution

---

## Machine Learning — Rent Estimation

### Problem

- Only ~105 units have real rent values
- Dataset size: ~3M units

→ Highly sparse supervision

---

### Solution

Use **OLS linear regression on log(rent)** to generate baseline rent estimates.

---

### Feature Set
