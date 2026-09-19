import { type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  useFailLink,
  useFailNode,
  useFindRoute,
  useGenerateNetwork,
  useHealthCheck,
  useRecoverRoute,
  useResetNetwork,
  useRunSimulation,
} from '@workspace/api-client-react';
import type {
  FailureResult,
  NetworkState,
  RecoveryResult,
  RouteResult,
  SimulationResult,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Cpu,
  Database,
  GitBranch,
  Link2,
  Loader2,
  Network,
  Play,
  RefreshCcw,
  RotateCcw,
  Server,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Target,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { Route, Switch, useLocation } from 'wouter';

const queryClient = new QueryClient();

type View = 'network' | 'simulations';

const fallbackNetwork: NetworkState = {
  nodes: [],
  edges: [],
  node_count: 0,
  edge_count: 0,
  connected: false,
  failed_nodes: [],
  failed_links: [],
};

function fmt(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div data-testid="status-error" className="flex items-center justify-between gap-3 border border-[hsl(var(--destructive)/.38)] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-xs text-[hsl(var(--destructive))]">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</span>
      {onRetry && <button data-testid="button-retry" onClick={onRetry} className="font-mono uppercase tracking-wider underline underline-offset-4">Retry</button>}
    </div>
  );
}

function Metric({ label, value, tone = 'default', detail }: { label: string; value: ReactNode; tone?: 'default' | 'cyan' | 'amber' | 'red'; detail?: string }) {
  const toneClass = { default: 'text-foreground', cyan: 'text-primary', amber: 'text-accent', red: 'text-destructive' }[tone];
  return (
    <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="border-l border-border pl-3">
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${toneClass}`}>{value}</div>
      {detail && <div className="mt-1 text-[10px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

function Topology({ network, route, recoveryRoute, failedComponent }: { network: NetworkState; route: string[]; recoveryRoute: string[]; failedComponent?: string | null }) {
  const width = 760;
  const height = 430;
  const nodeMap = useMemo(() => new Map(network.nodes.map((node) => [node.id, node])), [network.nodes]);
  const routeEdges = useMemo(() => new Set(route.slice(0, -1).map((id, i) => `${id}|${route[i + 1]}`)), [route]);
  const recoveryEdges = useMemo(() => new Set(recoveryRoute.slice(0, -1).map((id, i) => `${id}|${recoveryRoute[i + 1]}`)), [recoveryRoute]);
  if (!network.nodes.length) {
    return <div data-testid="topology-empty" className="grid h-[min(52vw,430px)] min-h-[280px] place-items-center border border-dashed border-border bg-[hsl(var(--muted)/.24)] text-center"><div><Network className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Awaiting topology</p><p className="mt-2 text-xs text-muted-foreground">Generate a network to begin the experiment.</p></div></div>;
  }
  const line = (source: string, target: string) => {
    const a = nodeMap.get(source); const b = nodeMap.get(target);
    if (!a || !b) return null;
    const normal = `${source}|${target}`; const reverse = `${target}|${source}`;
    const failed = !network.edges.find((edge) => (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source))?.active;
    const activeRoute = routeEdges.has(normal) || routeEdges.has(reverse);
    const activeRecovery = recoveryEdges.has(normal) || recoveryEdges.has(reverse);
    return <g key={`${source}-${target}`}>
      <line x1={a.x * width / 100} y1={a.y * height / 100} x2={b.x * width / 100} y2={b.y * height / 100} stroke={failed ? 'hsl(0 74% 61% / .68)' : activeRecovery ? 'hsl(37 94% 62%)' : activeRoute ? 'hsl(187 89% 55%)' : 'hsl(216 18% 32%)'} strokeWidth={activeRecovery || activeRoute ? 3 : 1.5} strokeDasharray={failed ? '6 5' : undefined} />
      <text x={(a.x + b.x) * width / 200} y={(a.y + b.y) * height / 200 - 6} fill="hsl(215 13% 57%)" fontSize="10" textAnchor="middle" className="font-mono">{network.edges.find((edge) => (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source))?.cost ?? ''}</text>
    </g>;
  };
  return <div data-testid="topology-diagram" className="grid-surface relative min-h-[280px] w-full overflow-hidden border border-border bg-[hsl(var(--muted)/.16)]">
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[min(52vw,430px)] min-h-[280px] w-full" role="img" aria-label="Network topology diagram">
      {network.edges.map((edge) => line(edge.source, edge.target))}
      {network.nodes.map((node) => {
        const isRoute = route.includes(node.id); const isRecovery = recoveryRoute.includes(node.id);
        const failed = !node.active; const emphasized = failedComponent === node.id;
        return <g key={node.id} data-testid={`topology-node-${node.id}`}>
          {emphasized && <circle cx={node.x * width / 100} cy={node.y * height / 100} r="25" fill="none" stroke="hsl(37 94% 62%)" strokeWidth="2" strokeDasharray="3 4" />}
          <circle cx={node.x * width / 100} cy={node.y * height / 100} r="18" fill={failed ? 'hsl(0 74% 61% / .18)' : isRecovery ? 'hsl(37 94% 62% / .2)' : isRoute ? 'hsl(187 89% 55% / .2)' : 'hsl(220 22% 11%)'} stroke={failed ? 'hsl(0 74% 61%)' : isRecovery ? 'hsl(37 94% 62%)' : isRoute ? 'hsl(187 89% 55%)' : 'hsl(216 18% 42%)'} strokeWidth={isRoute || isRecovery ? 2.5 : 1.5} />
          <text x={node.x * width / 100} y={node.y * height / 100 + 4} fill={failed ? 'hsl(0 74% 68%)' : 'hsl(210 22% 88%)'} fontSize="11" textAnchor="middle" className="font-mono font-semibold">{node.id.replace('node-', 'N')}</text>
        </g>;
      })}
    </svg>
    <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 bg-[hsl(var(--background)/.82)] px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur">
      <span className="flex items-center gap-1.5"><i className="h-1.5 w-4 bg-primary" />Active route</span>
      <span className="flex items-center gap-1.5"><i className="h-1.5 w-4 bg-accent" />Recovery path</span>
      <span className="flex items-center gap-1.5"><i className="h-1.5 w-4 bg-destructive" />Failed</span>
    </div>
  </div>;
}

function AppShell() {
  const [view, setView] = useState<View>('network');
  const [network, setNetwork] = useState<NetworkState>(fallbackNetwork);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [failure, setFailure] = useState<FailureResult | null>(null);
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [nodeCount, setNodeCount] = useState('12');
  const [density, setDensity] = useState('0.34');
  const [seed, setSeed] = useState('17');
  const [simCount, setSimCount] = useState(50);
  const [failureMode, setFailureMode] = useState<'link' | 'node'>('link');
  const [selectedLink, setSelectedLink] = useState('');
  const [selectedNode, setSelectedNode] = useState('');
  const [notice, setNotice] = useState('');
  const health = useHealthCheck();
  const generate = useGenerateNetwork();
  const reset = useResetNetwork();
  const findRoute = useFindRoute();
  const failLink = useFailLink();
  const failNode = useFailNode();
  const recover = useRecoverRoute();
  const runSimulation = useRunSimulation();

  const nodes = network.nodes;
  const activeEdges = network.edges.filter((edge) => edge.active);
  const displayedNetwork = failure?.network ?? network;
  const isBusy = generate.isPending || reset.isPending || findRoute.isPending || failLink.isPending || failNode.isPending || recover.isPending || runSimulation.isPending;
  const error = generate.error || reset.error || findRoute.error || failLink.error || failNode.error || recover.error || runSimulation.error;
  const routeList = route?.route ?? [];
  const recoveryList = recovery?.recovery_route ?? [];

  const generateNetwork = () => {
    setNotice('');
    setRoute(null); setFailure(null); setRecovery(null); setSimulation(null);
    generate.mutate({ data: { node_count: Number(nodeCount), density: Number(density), seed: Number(seed) } }, {
      onSuccess: (result) => {
        setNetwork(result);
        setSource(result.nodes[0]?.id ?? '');
        setDestination(result.nodes[result.nodes.length - 1]?.id ?? '');
        setNotice('Topology generated and ready.');
      },
    });
  };
  const resetNetwork = () => {
    setNotice('');
    reset.mutate(undefined, { onSuccess: (result) => { setNetwork(result); setFailure(null); setRecovery(null); setRoute(null); setNotice('All failures cleared. Network restored.'); } });
  };
  const find = () => {
    if (!source || !destination || source === destination) { setNotice('Choose two different endpoints.'); return; }
    setNotice('');
    findRoute.mutate({ data: { source, destination } }, { onSuccess: (result) => { setRoute(result); setRecovery(null); setNotice(result.reachable ? 'Lowest-cost route found.' : 'Destination is unreachable from source.'); } });
  };
  const inject = () => {
    setNotice('');
    if (failureMode === 'link') {
      const [linkSource, linkTarget] = selectedLink.split('|');
      if (!linkSource || !linkTarget) { setNotice('Select an active link to fail.'); return; }
      failLink.mutate({ data: { source: linkSource, target: linkTarget } }, { onSuccess: (result) => { setFailure(result); setNetwork(result.network); setRecovery(null); setNotice(`Link ${result.failed_component} failed.`); } });
    } else {
      if (!selectedNode) { setNotice('Select an active node to fail.'); return; }
      failNode.mutate({ data: { node: selectedNode } }, { onSuccess: (result) => { setFailure(result); setNetwork(result.network); setRecovery(null); setNotice(`Node ${result.failed_component} failed.`); } });
    }
  };
  const recoverRoute = () => recover.mutate(undefined, { onSuccess: (result) => { setRecovery(result); setNotice(result.status === 'recovered' ? 'Alternate route recovered.' : 'No alternate route available.'); } });
  const runBatch = () => {
    setNotice('');
    runSimulation.mutate({ data: { simulations: simCount, node_count: Number(nodeCount), density: Number(density), seed: Number(seed) } }, { onSuccess: (result) => { setSimulation(result); setView('simulations'); setNotice('Batch simulation complete.'); } });
  };

  return <div className="scanlines min-h-[100dvh] bg-background">
    <header className="sticky top-0 z-30 border-b border-border bg-[hsl(var(--background)/.92)] backdrop-blur">
      <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-4 px-4 py-3 lg:px-7">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center border border-primary/40 bg-primary/10 text-primary"><Network className="h-5 w-5" /></div>
          <div><div className="font-mono text-sm font-semibold tracking-[.16em] text-foreground">NET<span className="text-primary">RESCUE</span></div><div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">resilience laboratory / v0.1</div></div>
        </div>
        <div className="hidden items-center gap-5 md:flex">
          <div data-testid="status-api" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-destructive' : 'status-pulse bg-primary'}`} /> API {health.isError ? 'offline' : 'online'}</div>
          <div className="h-4 w-px bg-border" />
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">classroom mode <span className="text-accent">active</span></div>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-[1540px] px-4 py-5 lg:px-7 lg:py-7">
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary"><Activity className="h-3.5 w-3.5" />Experiment console <span className="text-muted-foreground">/</span> {view === 'network' ? 'topology' : 'batch analysis'}</div><h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{view === 'network' ? 'Network failure lab' : 'Simulation analysis'}</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{view === 'network' ? 'Generate a weighted network, route traffic through it, then observe how recovery algorithms respond under pressure.' : 'Aggregate evidence from repeated failure scenarios. Use the distributions to discuss where resilience holds and where it breaks.'}</p></div>
        <div className="flex items-center gap-1 border border-border bg-card p-1">
          <button data-testid="button-view-network" onClick={() => setView('network')} className={`flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${view === 'network' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><GitBranch className="h-3.5 w-3.5" /> Live network</button>
          <button data-testid="button-view-simulations" onClick={() => setView('simulations')} className={`flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${view === 'simulations' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Activity className="h-3.5 w-3.5" /> Simulations</button>
        </div>
      </div>
      {notice && <div data-testid="status-notice" className="mb-4 flex items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2.5 font-mono text-xs text-primary"><Check className="h-4 w-4" />{notice}</div>}
      {error && <div className="mb-4"><ErrorNotice message="The last operation could not be completed." onRetry={view === 'network' ? generateNetwork : runBatch} /></div>}
      {view === 'network' ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="min-w-0 space-y-5">
          <div className="border border-border bg-card panel-shadow">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center bg-primary/10 text-primary"><Network className="h-3.5 w-3.5" /></span><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Topology canvas</h2></div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{network.connected ? <span className="text-primary">Connected graph</span> : 'No active graph'} <span className="mx-2 text-border">|</span> {network.node_count} nodes / {network.edge_count} links</div></div>
            <Topology network={displayedNetwork} route={routeList} recoveryRoute={recoveryList} failedComponent={recovery?.failed_component ?? failure?.failed_component} />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="border border-border bg-card p-4 panel-shadow">
              <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Build network</h2></div><span className="font-mono text-[9px] text-muted-foreground">PARAMETERS</span></div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nodes<input data-testid="input-node-count" value={nodeCount} onChange={(e) => setNodeCount(e.target.value)} type="number" min="4" max="40" className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Density<input data-testid="input-density" value={density} onChange={(e) => setDensity(e.target.value)} type="number" min=".15" max=".9" step=".01" className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-sm text-foreground outline-none focus:border-primary" /></label>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Seed<input data-testid="input-seed" value={seed} onChange={(e) => setSeed(e.target.value)} type="number" min="0" className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-sm text-foreground outline-none focus:border-primary" /></label>
              </div>
              <button data-testid="button-generate-network" onClick={generateNetwork} disabled={isBusy} className="mt-4 flex w-full items-center justify-center gap-2 bg-primary px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50">{generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Generate topology</button>
            </div>
            <div className="border border-border bg-card p-4 panel-shadow">
              <div className="mb-4 flex items-center gap-2"><Target className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Route planner</h2></div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Source<select data-testid="select-source" value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"><option value="">Select</option>{nodes.map((node) => <option key={node.id} value={node.id} disabled={!node.active}>{node.id}</option>)}</select></label>
                <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Destination<select data-testid="select-destination" value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"><option value="">Select</option>{nodes.map((node) => <option key={node.id} value={node.id} disabled={!node.active}>{node.id}</option>)}</select></label>
              </div>
              <button data-testid="button-find-route" onClick={find} disabled={isBusy || !network.nodes.length} className="mt-4 flex w-full items-center justify-center gap-2 border border-primary/50 bg-primary/10 px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40">{findRoute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />} Find lowest-cost route</button>
            </div>
          </div>
          {(route || failure || recovery) && <section data-testid="route-result" className="reveal border border-border bg-card panel-shadow">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><Signal className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Operational readout</h2></div><span className={`font-mono text-[10px] uppercase tracking-wider ${recovery?.status === 'recovered' || route?.reachable ? 'text-primary' : 'text-destructive'}`}>{recovery?.status ?? (route?.reachable ? 'reachable' : 'unreachable')}</span></div>
            <div className="grid gap-5 p-4 md:grid-cols-[1.1fr_1fr]">
              <div><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Path sequence</div><div className="flex flex-wrap items-center gap-1.5 font-mono text-sm">{(recovery?.recovery_route?.length ? recovery.recovery_route : route?.route ?? []).map((item, index, items) => <span key={`${item}-${index}`} className="flex items-center gap-1.5"><span className={`border px-2 py-1 ${recovery?.recovery_route?.length ? 'border-accent/45 bg-accent/10 text-accent' : 'border-primary/40 bg-primary/10 text-primary'}`}>{item}</span>{index < items.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}</span>)}</div>{route && !route.reachable && <div className="mt-3 flex items-center gap-2 text-xs text-destructive"><X className="h-4 w-4" />No active path reaches the destination.</div>}</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Cost" value={fmt(recovery?.recovery_cost ?? route?.total_cost)} tone={recovery?.recovery_route?.length ? 'amber' : 'cyan'} /><Metric label="Hops" value={recovery?.recovery_hops ?? route?.hop_count} /><Metric label="Delta" value={recovery ? `+${fmt(recovery.additional_cost)}` : '—'} tone="amber" /><Metric label="Impact" value={failure ? (failure.affected_route ? 'Route' : 'None') : '—'} tone={failure?.affected_route ? 'red' : 'default'} /></div>
            </div>
          </section>}
        </section>
        <aside className="space-y-5">
          <div className="border border-border bg-card panel-shadow">
            <div className="border-b border-border px-4 py-3"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-accent" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Inject failure</h2></div><p className="mt-1 text-xs text-muted-foreground">Disable one component and observe route impact.</p></div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-1 border border-border bg-muted p-1"><button data-testid="button-failure-link" onClick={() => setFailureMode('link')} className={`py-2 font-mono text-[10px] uppercase tracking-wider ${failureMode === 'link' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}><Link2 className="mr-1 inline h-3.5 w-3.5" /> Link</button><button data-testid="button-failure-node" onClick={() => setFailureMode('node')} className={`py-2 font-mono text-[10px] uppercase tracking-wider ${failureMode === 'node' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}><Server className="mr-1 inline h-3.5 w-3.5" /> Node</button></div>
              {failureMode === 'link' ? <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Active link<select data-testid="select-failure-link" value={selectedLink} onChange={(e) => setSelectedLink(e.target.value)} className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"><option value="">Select link</option>{activeEdges.map((edge) => <option key={`${edge.source}|${edge.target}`} value={`${edge.source}|${edge.target}`}>{edge.source} ↔ {edge.target} · {edge.cost}</option>)}</select></label> : <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Active node<select data-testid="select-failure-node" value={selectedNode} onChange={(e) => setSelectedNode(e.target.value)} className="mt-1 w-full border border-input bg-muted px-2 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"><option value="">Select node</option>{nodes.filter((node) => node.active).map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>}
              <button data-testid="button-inject-failure" onClick={inject} disabled={isBusy || !network.nodes.length} className="flex w-full items-center justify-center gap-2 border border-accent/50 bg-accent/10 px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40">{failLink.isPending || failNode.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} Inject {failureMode} failure</button>
              {failure && <div data-testid="failure-summary" className="border-l-2 border-accent bg-accent/5 p-3 text-xs"><div className="font-mono text-accent">{failure.failure_type.toUpperCase()} / {failure.failed_component}</div><div className="mt-1 text-muted-foreground">{failure.affected_route ? 'The selected route was affected.' : 'The selected route was not affected.'} Destination is {failure.destination_reachable ? 'reachable.' : 'unreachable.'}</div></div>}
            </div>
          </div>
          <div className="border border-border bg-card panel-shadow">
            <div className="border-b border-border px-4 py-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Recovery controls</h2></div></div>
            <div className="space-y-3 p-4"><p className="text-xs leading-relaxed text-muted-foreground">Calculate the best available route after the injected failure. Recovery uses the current network state.</p><button data-testid="button-recover-route" onClick={recoverRoute} disabled={isBusy || !failure} className="flex w-full items-center justify-center gap-2 bg-primary px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35">{recover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Calculate recovery</button>{recovery && <div data-testid="recovery-summary" className={`border-l-2 p-3 text-xs ${recovery.status === 'recovered' ? 'border-primary bg-primary/5' : 'border-destructive bg-destructive/5'}`}><div className={`font-mono uppercase tracking-wider ${recovery.status === 'recovered' ? 'text-primary' : 'text-destructive'}`}>{recovery.status === 'recovered' ? 'Recovery confirmed' : 'Recovery failed'}</div><div className="mt-1 text-muted-foreground">{recovery.status === 'recovered' ? `Additional cost ${fmt(recovery.additional_cost)} across ${recovery.recovery_hops} hops.` : 'The destination cannot be reached with the remaining active components.'}</div></div>}</div>
          </div>
          <button data-testid="button-reset-network" onClick={resetNetwork} disabled={isBusy || !network.nodes.length} className="flex w-full items-center justify-center gap-2 border border-border bg-card px-3 py-3 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset network failures</button>
          <div className="border border-border bg-card p-4 panel-shadow"><div className="mb-3 flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Network telemetry</h2></div><div className="grid grid-cols-2 gap-x-4 gap-y-4"><Metric label="Active nodes" value={displayedNetwork.nodes.filter((n) => n.active).length} /><Metric label="Active links" value={displayedNetwork.edges.filter((e) => e.active).length} /><Metric label="Failed nodes" value={displayedNetwork.failed_nodes.length} tone={displayedNetwork.failed_nodes.length ? 'red' : 'default'} /><Metric label="Failed links" value={displayedNetwork.failed_links.length} tone={displayedNetwork.failed_links.length ? 'red' : 'default'} /></div></div>
          <div className="border border-primary/20 bg-primary/5 p-4"><div className="flex items-start gap-3"><Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><div className="font-mono text-[10px] uppercase tracking-widest text-primary">Teaching cue</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Compare the original and recovery path. A higher cost is the measurable price of resilience.</p></div></div></div>
        </aside>
      </div> : <SimulationView simulation={simulation} simCount={simCount} setSimCount={setSimCount} runBatch={runBatch} busy={runSimulation.isPending} />}
    </main>
    <footer className="mx-auto flex max-w-[1540px] items-center justify-between border-t border-border px-4 py-4 font-mono text-[9px] uppercase tracking-widest text-muted-foreground lg:px-7"><span>NetRescue / deterministic network lab</span><span>seed {seed} · {density} density</span></footer>
  </div>;
}

function SimulationView({ simulation, simCount, setSimCount, runBatch, busy }: { simulation: SimulationResult | null; simCount: number; setSimCount: (value: number) => void; runBatch: () => void; busy: boolean }) {
  const values = [10, 50, 100, 500, 1000];
  return <div className="space-y-5">
    <section className="border border-border bg-card panel-shadow"><div className="flex flex-col justify-between gap-4 border-b border-border px-4 py-4 md:flex-row md:items-center"><div><div className="font-mono text-[10px] uppercase tracking-widest text-primary">Batch runner</div><h2 className="mt-1 text-lg font-semibold">Stress-test recovery</h2><p className="mt-1 text-xs text-muted-foreground">Run reproducible scenarios against generated topologies to produce classroom-ready evidence.</p></div><button data-testid="button-run-simulation" onClick={runBatch} disabled={busy} className="flex items-center justify-center gap-2 bg-primary px-4 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:opacity-85 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run simulation</button></div><div className="grid gap-4 p-4 md:grid-cols-[1fr_2fr]"><div><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Iterations</div><div className="flex flex-wrap gap-2">{values.map((value) => <button key={value} data-testid={`button-sim-${value}`} onClick={() => setSimCount(value)} className={`border px-3 py-2 font-mono text-xs ${simCount === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>{value}</button>)}</div></div><div className="flex items-end"><div className="w-full border-l-2 border-accent/60 bg-accent/5 px-3 py-2 text-xs text-muted-foreground"><span className="font-mono text-accent">METHOD / </span>Each iteration generates a topology, finds a route, injects a random link or node failure, and measures recovery.</div></div></div></section>
    {!simulation ? <div data-testid="simulation-empty" className="grid min-h-[330px] place-items-center border border-dashed border-border bg-[hsl(var(--muted)/.18)] text-center"><div><Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No batch data</p><p className="mt-2 text-xs text-muted-foreground">Choose an iteration count and run the experiment.</p></div></div> : <SimulationResults result={simulation} />}
  </div>;
}

function SimulationResults({ result }: { result: SimulationResult }) {
  const successRate = Math.max(0, Math.min(100, result.recovery_success_rate));
  const maxFailure = Math.max(result.failure_breakdown.link, result.failure_breakdown.node, 1);
  return <div data-testid="simulation-results" className="space-y-5 reveal">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Success rate" value={`${fmt(successRate)}%`} tone="cyan" detail={`${result.successful_recoveries} recovered / ${result.total_simulations} runs`} /><Metric label="Affected routes" value={result.affected_routes} tone="amber" detail={`${result.failures_generated} failures generated`} /><Metric label="Failed recoveries" value={result.failed_recoveries} tone={result.failed_recoveries ? 'red' : 'default'} detail="No alternate route found" /><Metric label="Avg added cost" value={fmt(result.average_additional_cost)} tone="amber" detail="recovery − original" /></div>
    <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <section className="border border-border bg-card p-4 panel-shadow"><div className="mb-5 flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-widest text-primary">Failure mix</div><h2 className="mt-1 font-semibold">What broke the network</h2></div><span className="font-mono text-[10px] text-muted-foreground">{result.total_simulations} total runs</span></div><div className="space-y-5"><div><div className="mb-2 flex justify-between font-mono text-xs"><span className="text-muted-foreground">Link failures</span><span className="text-foreground">{result.failure_breakdown.link}</span></div><div className="h-3 bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(result.failure_breakdown.link / maxFailure) * 100}%` }} /></div></div><div><div className="mb-2 flex justify-between font-mono text-xs"><span className="text-muted-foreground">Node failures</span><span className="text-foreground">{result.failure_breakdown.node}</span></div><div className="h-3 bg-muted"><div className="h-full bg-accent transition-all" style={{ width: `${(result.failure_breakdown.node / maxFailure) * 100}%` }} /></div></div></div></section>
      <section className="border border-border bg-card p-4 panel-shadow"><div className="mb-5"><div className="font-mono text-[10px] uppercase tracking-widest text-primary">Route economics</div><h2 className="mt-1 font-semibold">Average path metrics</h2></div><div className="grid grid-cols-2 gap-5"><Metric label="Original cost" value={fmt(result.average_original_cost)} tone="cyan" /><Metric label="Recovery cost" value={fmt(result.average_recovery_cost)} tone="amber" /><Metric label="Original hops" value={fmt(result.average_original_hops, 0)} /><Metric label="Recovery hops" value={fmt(result.average_recovery_hops, 0)} tone="amber" /></div></section>
    </div>
    <div className="border border-border bg-card p-4 panel-shadow"><div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h2 className="font-mono text-xs font-semibold uppercase tracking-widest">Run summary</h2></div><div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3"><div className="border-l border-border pl-3"><span className="font-mono text-primary">{result.total_simulations}</span> scenarios evaluated</div><div className="border-l border-border pl-3"><span className="font-mono text-accent">{fmt(result.average_additional_cost)}</span> average resilience overhead</div><div className="border-l border-border pl-3"><span className="font-mono text-foreground">{result.failed_recoveries}</span> destinations left unreachable</div></div></div>
  </div>;
}

function Router() {
  return <ErrorBoundary resetKey={window.location.pathname}><Switch><Route path="/" component={AppShell} /><Route component={AppShell} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;