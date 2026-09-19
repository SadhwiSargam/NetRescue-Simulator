from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class NetworkGenerateInput(BaseModel):
    node_count: int = Field(ge=4, le=40)
    seed: int = Field(ge=0)
    density: float = Field(default=0.34, ge=0.15, le=0.9)


class RouteInput(BaseModel):
    source: str = Field(min_length=1)
    destination: str = Field(min_length=1)


class LinkFailureInput(BaseModel):
    source: str
    target: str


class NodeFailureInput(BaseModel):
    node: str


class SimulationInput(BaseModel):
    simulations: int = Field(ge=1, le=1000)
    node_count: int = Field(ge=4, le=40)
    seed: int = Field(ge=0)
    density: float = Field(default=0.34, ge=0.15, le=0.9)


class NetworkNode(BaseModel):
    id: str
    active: bool
    x: float
    y: float


class NetworkEdge(BaseModel):
    source: str
    target: str
    cost: float
    active: bool


class NetworkState(BaseModel):
    nodes: list[NetworkNode]
    edges: list[NetworkEdge]
    node_count: int
    edge_count: int
    connected: bool
    failed_nodes: list[str]
    failed_links: list[list[str]]


class RouteResult(BaseModel):
    route: list[str]
    total_cost: float
    hop_count: int
    reachable: bool
    source: str
    destination: str


class FailureResult(BaseModel):
    failure_type: Literal["LINK", "NODE"]
    failed_component: str
    affected_route: bool
    destination_reachable: bool
    network: NetworkState


class RecoveryResult(BaseModel):
    status: Literal["RECOVERED", "NO ALTERNATIVE PATH"]
    original_route: list[str]
    recovery_route: list[str]
    original_cost: float
    recovery_cost: float | None
    additional_cost: float | None
    original_hops: int
    recovery_hops: int | None
    failed_component: str | None


class FailureBreakdown(BaseModel):
    link: int
    node: int


class SimulationResult(BaseModel):
    total_simulations: int
    failures_generated: int
    affected_routes: int
    successful_recoveries: int
    failed_recoveries: int
    recovery_success_rate: float
    average_original_cost: float
    average_recovery_cost: float
    average_additional_cost: float
    average_original_hops: float
    average_recovery_hops: float
    failure_breakdown: FailureBreakdown