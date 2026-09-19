from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Iterable

import networkx as nx

from .models import (
    FailureResult,
    NetworkEdge,
    NetworkNode,
    NetworkState,
    RecoveryResult,
    RouteResult,
    SimulationResult,
)


def _round(value: float) -> float:
    return round(float(value), 2)


def _link_key(source: str, target: str) -> tuple[str, str]:
    return tuple(sorted((source, target)))


def _make_graph(node_count: int, seed: int, density: float) -> nx.Graph:
    rng = random.Random(seed)
    graph = nx.Graph()
    node_ids = [f"N{i}" for i in range(1, node_count + 1)]

    for index, node_id in enumerate(node_ids):
        angle = (index / node_count) * 6.283185307
        radius = 34 + ((index * 17) % 16)
        graph.add_node(
            node_id,
            x=_round(50 + radius * __import__("math").cos(angle)),
            y=_round(50 + radius * __import__("math").sin(angle)),
        )

    # Start with a random spanning tree so every generated topology is connected.
    for index in range(1, node_count):
        parent = rng.randrange(index)
        graph.add_edge(node_ids[index], node_ids[parent], cost=rng.randint(1, 9))

    # Add a small number of redundant links according to the requested density.
    possible_edges = [
        (node_ids[left], node_ids[right])
        for left in range(node_count)
        for right in range(left + 1, node_count)
        if not graph.has_edge(node_ids[left], node_ids[right])
    ]
    rng.shuffle(possible_edges)
    target_edges = max(node_count - 1, round(node_count * (node_count - 1) * density / 2))
    for source, target in possible_edges[: max(0, target_edges - graph.number_of_edges())]:
        graph.add_edge(source, target, cost=rng.randint(1, 9))

    return graph


@dataclass
class NetworkEngine:
    graph: nx.Graph | None = None
    failed_nodes: set[str] = field(default_factory=set)
    failed_links: set[tuple[str, str]] = field(default_factory=set)
    seed: int = 42
    density: float = 0.34
    original_route: list[str] = field(default_factory=list)
    source: str | None = None
    destination: str | None = None
    failed_component: str | None = None
    failure_type: str | None = None

    def generate(self, node_count: int, seed: int, density: float) -> NetworkState:
        self.graph = _make_graph(node_count, seed, density)
        self.failed_nodes.clear()
        self.failed_links.clear()
        self.seed = seed
        self.density = density
        self.original_route.clear()
        self.source = None
        self.destination = None
        self.failed_component = None
        self.failure_type = None
        return self.state()

    def require_graph(self) -> nx.Graph:
        if self.graph is None:
            raise ValueError("Network has not been generated")
        return self.graph

    def active_graph(self) -> nx.Graph:
        graph = self.require_graph().copy()
        graph.remove_nodes_from(self.failed_nodes)
        graph.remove_edges_from(self.failed_links)
        return graph

    def state(self) -> NetworkState:
        graph = self.require_graph()
        nodes = [
            NetworkNode(
                id=node_id,
                active=node_id not in self.failed_nodes,
                x=float(graph.nodes[node_id]["x"]),
                y=float(graph.nodes[node_id]["y"]),
            )
            for node_id in graph.nodes
        ]
        edges = [
            NetworkEdge(
                source=source,
                target=target,
                cost=float(data["cost"]),
                active=(
                    source not in self.failed_nodes
                    and target not in self.failed_nodes
                    and _link_key(source, target) not in self.failed_links
                ),
            )
            for source, target, data in graph.edges(data=True)
        ]
        return NetworkState(
            nodes=nodes,
            edges=edges,
            node_count=graph.number_of_nodes(),
            edge_count=graph.number_of_edges(),
            connected=nx.is_connected(graph) if graph.number_of_nodes() else False,
            failed_nodes=sorted(self.failed_nodes),
            failed_links=[list(link) for link in sorted(self.failed_links)],
        )

    def route(self, source: str, destination: str, remember: bool = True) -> RouteResult:
        graph = self.require_graph()
        if source not in graph or destination not in graph:
            raise ValueError("Source or destination node does not exist")
        if source in self.failed_nodes or destination in self.failed_nodes:
            raise ValueError("Source and destination must be active")
        if source == destination:
            raise ValueError("Source and destination must be different")
        active = self.active_graph()
        try:
            path = nx.shortest_path(active, source, destination, weight="cost")
            cost = nx.path_weight(active, path, weight="cost")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            raise ValueError("No path exists between source and destination")
        if remember:
            self.original_route = list(path)
            self.source = source
            self.destination = destination
        return RouteResult(
            route=list(path),
            total_cost=_round(cost),
            hop_count=max(0, len(path) - 1),
            reachable=True,
            source=source,
            destination=destination,
        )

    def route_on_graph(
        self, graph: nx.Graph, source: str, destination: str
    ) -> tuple[list[str] | None, float | None]:
        try:
            path = nx.shortest_path(graph, source, destination, weight="cost")
            return list(path), float(nx.path_weight(graph, path, weight="cost"))
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None, None

    def fail_link(self, source: str, target: str) -> FailureResult:
        graph = self.require_graph()
        key = _link_key(source, target)
        if not graph.has_edge(source, target):
            raise ValueError("Link does not exist")
        if key in self.failed_links:
            raise ValueError("Failure already exists for this link")
        if source in self.failed_nodes or target in self.failed_nodes:
            raise ValueError("Cannot fail a link connected to a failed node")
        self.failed_links.add(key)
        self.failed_component = f"{source} — {target}"
        self.failure_type = "LINK"
        return self.failure_result(key in self.route_links(self.original_route))

    def fail_node(self, node: str) -> FailureResult:
        graph = self.require_graph()
        if node not in graph:
            raise ValueError("Node does not exist")
        if node in self.failed_nodes:
            raise ValueError("Failure already exists for this node")
        self.failed_nodes.add(node)
        self.failed_component = node
        self.failure_type = "NODE"
        return self.failure_result(node in self.original_route)

    def route_links(self, route: Iterable[str]) -> set[tuple[str, str]]:
        values = list(route)
        return {_link_key(values[index], values[index + 1]) for index in range(len(values) - 1)}

    def failure_result(self, affected: bool) -> FailureResult:
        reachable = False
        if self.source and self.destination:
            _, recovery_cost = self.route_on_graph(
                self.active_graph(), self.source, self.destination
            )
            reachable = recovery_cost is not None
        return FailureResult(
            failure_type=self.failure_type or "LINK",
            failed_component=self.failed_component or "Unknown",
            affected_route=affected,
            destination_reachable=reachable,
            network=self.state(),
        )

    def recover(self) -> RecoveryResult:
        if not self.original_route or not self.source or not self.destination:
            raise ValueError("Find an initial route before attempting recovery")
        graph = self.require_graph()
        original_cost = nx.path_weight(graph, self.original_route, weight="cost")
        recovery_route, recovery_cost = self.route_on_graph(
            self.active_graph(), self.source, self.destination
        )
        if recovery_route is None or recovery_cost is None:
            return RecoveryResult(
                status="NO ALTERNATIVE PATH",
                original_route=self.original_route,
                recovery_route=[],
                original_cost=_round(original_cost),
                recovery_cost=None,
                additional_cost=None,
                original_hops=max(0, len(self.original_route) - 1),
                recovery_hops=None,
                failed_component=self.failed_component,
            )
        return RecoveryResult(
            status="RECOVERED",
            original_route=self.original_route,
            recovery_route=recovery_route,
            original_cost=_round(original_cost),
            recovery_cost=_round(recovery_cost),
            additional_cost=_round(recovery_cost - original_cost),
            original_hops=max(0, len(self.original_route) - 1),
            recovery_hops=max(0, len(recovery_route) - 1),
            failed_component=self.failed_component,
        )

    def reset(self) -> NetworkState:
        self.require_graph()
        self.failed_nodes.clear()
        self.failed_links.clear()
        self.failed_component = None
        self.failure_type = None
        return self.state()


def run_batch(
    simulations: int, node_count: int, seed: int, density: float
) -> SimulationResult:
    rng = random.Random(seed)
    original_costs: list[float] = []
    recovery_costs: list[float] = []
    overheads: list[float] = []
    original_hops: list[int] = []
    recovery_hops: list[int] = []
    affected = successful = failed = 0
    breakdown = {"link": 0, "node": 0}

    for _ in range(simulations):
        graph = _make_graph(node_count, rng.randrange(0, 2**31), density)
        nodes = list(graph.nodes)
        source, destination = rng.sample(nodes, 2)
        path, cost = NetworkEngine().route_on_graph(graph, source, destination)
        if path is None or cost is None:
            continue
        original_costs.append(cost)
        original_hops.append(len(path) - 1)

        failure_type = rng.choice(["link", "node"])
        broken = graph.copy()
        if failure_type == "link":
            edge = rng.choice(list(graph.edges))
            broken.remove_edge(*edge)
            breakdown["link"] += 1
            affected_by_failure = _link_key(*edge) in {
                _link_key(path[index], path[index + 1]) for index in range(len(path) - 1)
            }
        else:
            failed_node = rng.choice(nodes)
            broken.remove_node(failed_node)
            breakdown["node"] += 1
            affected_by_failure = failed_node in path

        if not affected_by_failure:
            continue
        affected += 1
        alternate, alternate_cost = NetworkEngine().route_on_graph(
            broken, source, destination
        )
        if alternate is None or alternate_cost is None:
            failed += 1
            continue
        successful += 1
        recovery_costs.append(alternate_cost)
        overheads.append(alternate_cost - cost)
        recovery_hops.append(len(alternate) - 1)

    def average(values: list[float | int]) -> float:
        return _round(sum(values) / len(values)) if values else 0.0

    return SimulationResult(
        total_simulations=simulations,
        failures_generated=breakdown["link"] + breakdown["node"],
        affected_routes=affected,
        successful_recoveries=successful,
        failed_recoveries=failed,
        recovery_success_rate=_round((successful / affected) * 100) if affected else 0.0,
        average_original_cost=average(original_costs),
        average_recovery_cost=average(recovery_costs),
        average_additional_cost=average(overheads),
        average_original_hops=average(original_hops),
        average_recovery_hops=average(recovery_hops),
        failure_breakdown=breakdown,
    )