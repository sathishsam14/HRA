# HRA – Horse Rating Automation (Bangalore Turf Club)

Modern AI and rules-assisted rating recommender system for the Bangalore Turf Club (BTC) Racing Department.

## Architecture

```
                  ┌─────────────────────────────┐
                  │ Next.js 15 App (Frontend)   │
                  │   - Dashboard & KPIs        │
                  │   - Rating Engine & Review  │
                  │   - MIS Reporting           │
                  │   - Single-Column Uploads   │
                  └──────────────┬──────────────┘
                                 │ REST APIs
                                 ▼
┌─────────────────────────┐               ┌─────────────────────────────────┐
│ PostgreSQL Database     │               │ Python ML Service (FastAPI)     │
│   - Races & Entries     │               │   - BTC Hybrid Rating Model     │
│   - Handicapper Decision│               │   - Master Ingestion & Retrain  │
│   - Audit Logs & Users  │               │   - Active Hold-out Validation  │
└─────────────────────────┘               └─────────────────────────────────┘
```

1. **Python ML Service (`HRA-backend/`)**:
   - Owns 100% of the rating calculation and text mining.
   - Evaluates entrants using the client hybrid model (Rule base + Gradient Boosting + Steward report NLP flags).
   - Manages the master dataset (`BSM.xlsx`), archives previous versions with timestamps, and retrains upon master upload or handicapper race confirmations.
2. **Next.js Frontend (`HRA-frontend/`)**:
   - Dispatches declarations and report remarks to the Python service.
   - Enables official handicapper reviews, overrides with justifications, and per-race confirmations.
   - Presents confirmed decisions in MIS reports.
   - Unified single-column document upload portal.

---

## Supported Ingestion File Types

The system accepts exactly 6 document types:

1. **Master History (BSM)**: Consolidated historical race records (`.xlsx, .xls`) used to train the rating engine.
2. **Current Race (BWM)**: Current race day declarations, runner stats, and placings (`.xlsx, .xls`).
3. **Starter Report (Optional)**: Word, PDF, Excel, CSV, or text remarks from stall officials.
4. **Veterinary Report (Optional)**: Clinical and examination notes (lameness, EIPH, treatments).
5. **Incidence Report (Optional)**: Track interference, inquiries, and race steward incidents.
6. **Stipe Report (Optional)**: Stipendiary Stewards proceedings and disciplinary findings.

---

## Getting Started

### 1. Start Python Backend
```bash
cd HRA-backend
# activate python virtual environment
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
API runs at `http://localhost:8000` with Swagger docs at `http://localhost:8000/docs`.

### 2. Start Next.js Frontend
```bash
cd HRA-frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Build Verification
```bash
npm run build
```
Generates production build with zero errors.
