# NetRescue

NetRescue is a complete, local-first network resilience and automatic failure recovery simulator. It creates a virtual graph, calculates shortest routes, injects link or node failures, and measures whether an alternate route can keep the endpoints connected.

This is an educational simulation. It does not inspect, monitor, configure, or modify real networks, and its weighted shortest-path model is not a complete implementation of routing protocols such as OSPF or BGP.

## What it demonstrates

- Connected network topology generation with reproducible seeds
- Dijkstra shortest-path routing with positive edge costs
- Link failure and node failure injection
- Broken-route detection and alternate-path recovery
- Recovery cost and hop comparison
- Automatic batch experiments from 1 to 1,000 scenarios
- Dynamic resilience metrics without a database

## Technology

- Frontend: React, Vite, JavaScript/TypeScript, plain CSS
- Backend: Python 3, FastAPI, NetworkX, Uvicorn, Pydantic
- Tests: pytest
- Storage: in-memory only; no database or API keys

## Project layout

```text
backend/
  main.py                 FastAPI app and REST endpoints
  models.py               Request and response models
  engine.py               Graph, routing, failure, recovery, and batch logic
  requirements.txt
  tests/test_engine.py
artifacts/frontend/
  src/App.tsx             React application
  src/index.css           Application styling
lib/api-spec/
  openapi.yaml            API contract used for generated TypeScript types
```

## Run locally

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

The API is available at `http://localhost:8000/api`, including interactive docs at `/docs`.

### Frontend

```bash
pnpm install
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/frontend run dev
```

To preview the frontend locally, run the backend first, then start the frontend dev server. The frontend will automatically proxy API requests to `http://localhost:8000/api`.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/healthz` | Health check |
| POST | `/api/network/generate` | Generate a connected topology |
| POST | `/api/network/reset` | Clear active failures |
| POST | `/api/route` | Find a lowest-cost active route |
| POST | `/api/failure/link` | Fail a selected link |
| POST | `/api/failure/node` | Fail a selected node |
| POST | `/api/recover` | Compare the original route with recovery |
| POST | `/api/simulate` | Run reproducible automatic scenarios |

## How a scenario works

1. Generate a connected graph with a node count, density, and seed.
2. Choose two active endpoints.
3. Run Dijkstra on active links to get the current route, total cost, and hop count.
4. Mark a link or node as failed while keeping the failed component in the displayed topology.
5. Re-run shortest-path routing on the graph with failed components excluded.
6. Report `RECOVERED` with cost overhead, or `NO ALTERNATIVE PATH` without inventing a route.

Batch simulations repeat that workflow with a deterministic random generator and return aggregate values for affected routes, successful recovery, failed recovery, average costs, hops, and failure type counts.

## Tests

```bash
pytest backend/tests
```

The test suite covers connected and deterministic generation, shortest-path routing, link and node failures, recovery outcomes, and dynamic batch metrics.

## Limitations and future improvements

The simulator currently models undirected weighted links, a single in-memory session, and one failure at a time. It does not model packets, bandwidth, latency over time, routing advertisements, real devices, or concurrent users. Future student work could add directed links, multi-failure campaigns, topology export, or side-by-side algorithm comparisons while keeping the same clear simulation boundary.