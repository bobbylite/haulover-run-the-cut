// Everything that dresses the scene around Nantucket's water.

import { Group } from 'three/webgpu';
import { AmbientGulls } from '../../../render/ambientGulls';
import { Buoys } from '../../../render/buoys';
import type { Quality } from '../../../render/renderWorld';
import { BerthMarker } from '../../../render/world/berthMarker';
import type { Environment } from '../../../sim/environment';
import type { LocationProps, WildlifeInput } from '../../types';
import { BUOYS } from '../geography';
import { Fleet } from './fleet';
import { BrantLight } from './light';
import { buildTown } from './town';
import { Wharves } from './wharves';

export class NantucketProps implements LocationProps {
  readonly group = new Group();
  readonly berthMarker = new BerthMarker();
  private readonly fleet = new Fleet();
  private readonly wharves = new Wharves();
  private readonly light = new BrantLight();
  private readonly buoys = new Buoys(BUOYS);
  private readonly gulls: AmbientGulls;
  readonly wildlife: { update(dt: number, inp: WildlifeInput): void };

  constructor(quality: Quality) {
    this.group.name = 'nantucketProps';
    this.gulls = new AmbientGulls(quality === 'low' ? 10 : 22);
    this.wildlife = this.gulls;
    this.group.add(
      buildTown(quality),
      this.wharves.group,
      this.fleet.group,
      this.light.group,
      this.buoys.group,
      this.berthMarker.group,
      this.gulls.flock.mesh,
    );
  }

  update(_dt: number, time: number, env: Environment): void {
    this.fleet.update(env, time);
    this.buoys.update(env, time);
    this.light.update(time, env.weather?.night ? 1 : 0);
  }
}
