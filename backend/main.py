from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .engine import NetworkEngine, run_batch
from .models import (
    LinkFailureInput,
    NetworkGenerateInput,
    NodeFailureInput,
    RouteInput,
    SimulationInput,
)

app = FastAPI(
    title="NetRescue API",
    description="Network topology, routing, failure, and recovery simulation.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = NetworkEngine()


def user_error(error: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(error))


@app.get("/api/healthz")
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/network/generate")
def generate_network(request: NetworkGenerateInput):
    return engine.generate(request.node_count, request.seed, request.density)


@app.post("/api/network/reset")
def reset_network():
    try:
        return engine.reset()
    except ValueError as error:
        raise user_error(error)


@app.post("/api/route")
def find_route(request: RouteInput):
    try:
        return engine.route(request.source, request.destination)
    except ValueError as error:
        raise user_error(error)


@app.post("/api/failure/link")
def fail_link(request: LinkFailureInput):
    try:
        return engine.fail_link(request.source, request.target)
    except ValueError as error:
        raise user_error(error)


@app.post("/api/failure/node")
def fail_node(request: NodeFailureInput):
    try:
        return engine.fail_node(request.node)
    except ValueError as error:
        raise user_error(error)


@app.post("/api/recover")
def recover_route():
    try:
        return engine.recover()
    except ValueError as error:
        raise user_error(error)


@app.post("/api/simulate")
def simulate(request: SimulationInput):
    return run_batch(
        request.simulations, request.node_count, request.seed, request.density
    )