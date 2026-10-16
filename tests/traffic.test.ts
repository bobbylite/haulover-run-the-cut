import { describe, expect, it } from 'vitest';
import { laneOf } from '../src/game/traffic';
import { HAULOVER } from '../src/locations/haulover';
import { makeCourse } from '../src/locations/haulover/course';
import { hardSDF } from '../src/locations/haulover/geography';
import { GeoGrid } from '../src/sim/geoGrid';

describe('traffic lanes', () => {
  const path = makeCourse('outbound').path;
  const geo = GeoGrid.bake(HAULOVER);

  it('both lanes stay in deep water, clear of the seawalls and jetties', () => {
    for (const dir of [1, -1] as const) {
      for (const p of laneOf(path, dir)) {
        // the bay entrance has the shallowest water; 2.5 m is plenty for every hull in the game
        expect(-geo.heightAt(p.x, p.z), `depth at ${p.x},${p.z}`).toBeGreaterThan(2.5);
        expect(hardSDF(p.x, p.z), `clearance at ${p.x},${p.z}`).toBeGreaterThan(8);
      }
    }
  });

  it('eastbound runs east, westbound runs west, each on its own starboard side', () => {
    const east = laneOf(path, 1);
    const west = laneOf(path, -1);
    expect(east.at(-1)!.x).toBeGreaterThan(east[0]!.x);
    expect(west.at(-1)!.x).toBeLessThan(west[0]!.x);
    // in the straight outer bay the lanes are 2 x offset apart, eastbound to the south (+z)
    const e = east.find((p) => p.x > 700)!;
    const w = west.find((p) => p.x < 705 && p.x > 695)!;
    expect(e.z - w.z).toBeGreaterThan(25);
  });
});
