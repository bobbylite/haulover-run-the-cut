// The routes through Haulover Inlet: gates (buoy pairs) along the Cut, a centre-line path for progress,
// and the finish. Red marks sit on the north side, green on the south (IALA-B: "red right returning").
// Routes that come home end with the docking challenge in the south-shore marina.

import type { Course, DockPlan, Gate, Route } from '../../game/course';
import { BRIDGE_X, cutZ, DOCK_APPROACH, SLIP_BERTH } from './geography';

const OUT = [
  { x: -700, half: 78, label: 'ICW Junction' },
  { x: -500, half: 56, label: 'Bay Mouth' },
  { x: -310, half: 40, label: 'The Cut' },
  { x: -130, half: 38, label: 'Bridge Approach' },
  { x: BRIDGE_X, half: 38, label: 'Haulover Bridge', kind: 'bridge' as const },
  { x: 110, half: 40, label: 'Beach Roots' },
  { x: 280, half: 42, label: 'The Jetties' },
  { x: 440, half: 46, label: 'Jetty Tips' },
  { x: 620, half: 60, label: 'The Bar' },
  { x: 820, half: 80, label: 'Open Atlantic' },
];

function centreZ(x: number): number {
  return cutZ(Math.min(Math.max(x, -480), 480));
}

type Pt = { x: number; z: number; s: number };

function pushPts(path: Pt[], pts: readonly (readonly [number, number])[]): void {
  for (const [x, z] of pts) {
    const prev = path[path.length - 1];
    const s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
    path.push({ x, z, s });
  }
}

const eastbound = (from: number, to: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let x = from; x <= to; x += 20) pts.push([x, centreZ(x)]);
  return pts;
};

/** The sea-buoy turnaround: a wide arc round the buoy that rejoins the centre line at x = 620. */
const BUOY_X = 760;
const buoyTurn = (): [number, number][] => [
  [800, 14],
  [826, 46],
  [804, 80],
  [756, 84],
  [700, 58],
  [650, 22],
];

/** Westbound centre line from `from` back to the bay mouth. */
const westbound = (from: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let x = from; x >= -480; x -= 20) pts.push([x, centreZ(x)]);
  return pts;
};

/** The turn into the marina and the line through the piling field to the slip. */
const marinaApproach = (): [number, number][] => [
  [-505, -4],
  [-522, 10],
  ...DOCK_APPROACH.map(([x, z]) => [x, z] as [number, number]),
  [-402, SLIP_BERTH.z],
];

function westGates(scale: number, startIndex: number, maxX = 1e9): Gate[] {
  // the outbound list reversed; the ICW junction is behind us once we turn south into the marina
  return [...OUT]
    .reverse()
    .filter((g) => g.x > -600 && g.x <= maxX)
    .map((g, i) => ({
      index: startIndex + i,
      x: g.x,
      z: centreZ(g.x),
      nx: -1,
      nz: 0,
      half: g.half * scale,
      label: g.label,
      kind: g.kind ?? ('gate' as const),
    }));
}

function marinaGate(index: number, scale: number): Gate {
  const [x0, z0] = DOCK_APPROACH[0] as readonly [number, number];
  const [x1, z1] = DOCK_APPROACH[1] as readonly [number, number];
  const l = Math.hypot(x1 - x0, z1 - z0);
  return {
    index,
    x: x0,
    z: z0,
    nx: (x1 - x0) / l,
    nz: (z1 - z0) / l,
    half: 46 * scale,
    label: 'Marina Entrance',
    kind: 'dock',
  };
}

export function makeCourse(route: Route, gateScale = 1): Course {
  const dockPlan = (startGate: number): DockPlan => ({
    slip: SLIP_BERTH,
    approach: DOCK_APPROACH,
    startGate,
  });
  if (route === 'outbound') {
    const gates: Gate[] = OUT.map((g, i) => ({
      index: i,
      x: g.x,
      z: centreZ(g.x),
      nx: 1,
      nz: 0,
      half: g.half * gateScale,
      label: g.label,
      kind: g.kind ?? ('gate' as const),
    }));
    gates.push({
      index: gates.length,
      x: 1010,
      z: 0,
      nx: 1,
      nz: 0,
      half: 90 * gateScale,
      label: 'Sea Buoy',
      kind: 'finish',
    });
    const path: Pt[] = [];
    pushPts(path, eastbound(-900, 1050));
    return {
      route,
      gates,
      start: { x: -900, z: 0, heading: 0 },
      length: path[path.length - 1]!.s,
      path,
      title: 'Run the Cut: Outbound',
    };
  }

  if (route === 'inbound') {
    // from the sea buoy back in, through the Cut and across the bay, ending in the docking challenge
    const gates = westGates(gateScale, 0, 620);
    gates.push(marinaGate(gates.length, gateScale));
    const path: Pt[] = [];
    pushPts(path, westbound(760));
    pushPts(path, marinaApproach());
    return {
      route,
      gates,
      start: { x: 760, z: 0, heading: Math.PI },
      length: path[path.length - 1]!.s,
      path,
      dock: dockPlan(gates.length - 1),
      title: 'Run the Cut: Home & Dock',
    };
  }

  // full run: out to the sea buoy, round it, back through the Cut, and dock
  const gates: Gate[] = OUT.filter((g) => g.x >= -500 && g.x <= 620).map((g, i) => ({
    index: i,
    x: g.x,
    z: centreZ(g.x),
    nx: 1,
    nz: 0,
    half: g.half * gateScale,
    label: g.label,
    kind: g.kind ?? ('gate' as const),
  }));
  gates.push({
    index: gates.length,
    x: BUOY_X,
    z: 0,
    nx: 1,
    nz: 0,
    half: 90 * gateScale,
    label: 'Sea Buoy',
    kind: 'turn',
  });
  for (const g of westGates(gateScale, gates.length, 620)) gates.push({ ...g, label: `${g.label} (home)` });
  gates.push(marinaGate(gates.length, gateScale));
  const path: Pt[] = [];
  pushPts(path, eastbound(-700, 780));
  pushPts(path, buoyTurn());
  pushPts(path, westbound(620));
  pushPts(path, marinaApproach());
  return {
    route,
    gates,
    start: { x: -700, z: 0, heading: 0 },
    length: path[path.length - 1]!.s,
    path,
    dock: dockPlan(gates.length - 1),
    title: 'Run the Cut: Full Run & Dock',
  };
}
