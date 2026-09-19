from backend.engine import NetworkEngine, run_batch


def test_generated_graph_is_connected_and_deterministic():
    first = NetworkEngine()
    second = NetworkEngine()
    state_one = first.generate(10, 42, 0.34)
    state_two = second.generate(10, 42, 0.34)

    assert state_one.connected is True
    assert state_one.edge_count >= state_one.node_count - 1
    assert state_one.model_dump() == state_two.model_dump()


def test_route_uses_dijkstra_and_tracks_hops():
    engine = NetworkEngine()
    engine.generate(8, 7, 0.4)

    result = engine.route("N1", "N8")

    assert result.reachable is True
    assert result.route[0] == "N1"
    assert result.route[-1] == "N8"
    assert result.hop_count == len(result.route) - 1


def test_link_failure_marks_edge_and_can_recover():
    engine = NetworkEngine()
    state = engine.generate(10, 42, 0.5)
    route = engine.route("N1", "N10")
    edge = next(
        edge
        for edge in state.edges
        if [edge.source, edge.target] != [route.route[0], route.route[-1]]
    )

    failure = engine.fail_link(edge.source, edge.target)
    recovery = engine.recover()

    assert [edge.source, edge.target] in failure.network.failed_links or [
        edge.target,
        edge.source,
    ] in failure.network.failed_links
    assert recovery.status in {"RECOVERED", "NO ALTERNATIVE PATH"}


def test_node_failure_marks_node_and_recovery_never_fabricates_a_path():
    engine = NetworkEngine()
    engine.generate(6, 12, 0.15)
    engine.route("N1", "N6")

    failure = engine.fail_node("N1")
    recovery = engine.recover()

    assert failure.network.nodes[0].active is False
    assert recovery.status == "NO ALTERNATIVE PATH"
    assert recovery.recovery_route == []


def test_batch_metrics_are_dynamic_and_seeded():
    first = run_batch(25, 10, 42, 0.34)
    second = run_batch(25, 10, 42, 0.34)

    assert first.model_dump() == second.model_dump()
    assert first.total_simulations == 25
    assert first.failures_generated == 25
    assert 0 <= first.recovery_success_rate <= 100