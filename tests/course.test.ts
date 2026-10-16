import { describe, expect, it } from 'vitest';
import { crossedGate, pathProgress } from '../src/game/course';
import { makeCourse } from '../src/locations/haulover/course';

describe('course', () => {
  it('outbound gates are ordered west to east and the finish is last', () => {
    const c = makeCourse('outbound');
    for (let i = 1; i < c.gates.length; i++) expect(c.gates[i]!.x).toBeGreaterThan(c.gates[i - 1]!.x);
    expect(c.gates.at(-1)!.kind).toBe('finish');
    expect(c.length).toBeGreaterThan(1500);
  });

  it('detects a centred crossing and ignores a wide miss', () => {
    const c = makeCourse('outbound');
    const g = c.gates[3]!;
    expect(crossedGate(g, g.x - 2, g.z, g.x + 2, g.z)?.offset).toBeCloseTo(0, 1);
    expect(crossedGate(g, g.x - 2, g.z + g.half + 30, g.x + 2, g.z + g.half + 30)).toBeNull();
    // wrong direction does not count
    expect(crossedGate(g, g.x + 2, g.z, g.x - 2, g.z)).toBeNull();
  });

  it('projects progress monotonically along the path', () => {
    const c = makeCourse('outbound');
    let hint = 0;
    let last = -1;
    for (let x = -880; x < 1000; x += 50) {
      const p = pathProgress(c, x, c.path.find((q) => q.x >= x)!.z + 3, hint);
      expect(p.s).toBeGreaterThanOrEqual(last);
      last = p.s;
      hint = p.idx;
    }
  });

  it('inbound and full runs end at the marina entrance and carry a docking plan', () => {
    for (const route of ['inbound', 'full'] as const) {
      const c = makeCourse(route);
      expect(c.dock, route).toBeDefined();
      expect(c.gates.at(-1)!.kind).toBe('dock');
      expect(c.dock!.startGate).toBe(c.gates.length - 1);
    }
    expect(makeCourse('inbound').start.heading).toBeCloseTo(Math.PI);
    expect(makeCourse('outbound').dock).toBeUndefined();
  });

  it('the full run goes out, turns at the buoy and comes home', () => {
    const c = makeCourse('full');
    const turn = c.gates.findIndex((g) => g.kind === 'turn');
    expect(turn).toBeGreaterThan(3);
    for (let i = 0; i < turn; i++) expect(c.gates[i]!.nx).toBeGreaterThan(0);
    for (let i = turn + 1; i < c.gates.length - 1; i++) expect(c.gates[i]!.nx).toBe(-1);
  });

  it('harder difficulties pinch the gates', () => {
    const wide = makeCourse('outbound', 1);
    const tight = makeCourse('outbound', 0.55);
    expect(tight.gates[3]!.half).toBeLessThan(wide.gates[3]!.half * 0.6);
  });
});
