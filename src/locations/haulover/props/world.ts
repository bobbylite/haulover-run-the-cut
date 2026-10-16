// Everything that dresses the scene around the water.

import { Group } from 'three/webgpu';
import type { Quality } from '../../../render/renderWorld';
import { DockMarker } from '../../../render/world/dockMarker';
import type { Environment } from '../../../sim/environment';
import type { LocationProps, SlipBerth } from '../../types';
import { Beach, Sandbar } from './beach';
import { Bridge } from './bridge';
import { City } from './city';
import { buildJetties } from './jetties';
import { Marina } from './marina';
import { PilingField } from './pilings';
import { buildSeawalls } from './seawall';
import { Vegetation } from './vegetation';
import { Wildlife } from './wildlife';

export class WorldProps implements LocationProps {
  readonly group = new Group();
  private readonly bridge = new Bridge();
  private readonly marina = new Marina();
  private readonly beach: Beach;
  private readonly sandbar = new Sandbar();
  readonly wildlife: Wildlife;
  readonly dockMarker: DockMarker;
  private readonly pilings = new PilingField();

  constructor(quality: Quality, berth: SlipBerth) {
    this.group.name = 'worldProps';
    this.dockMarker = new DockMarker(berth);
    this.beach = new Beach(quality);
    this.wildlife = new Wildlife(quality);
    this.group.add(
      buildSeawalls(),
      buildJetties(),
      this.bridge.group,
      this.marina.group,
      new City().group,
      new Vegetation(quality).group,
      this.beach.group,
      this.sandbar.group,
      this.wildlife.group,
      this.pilings.group,
      this.dockMarker.mesh,
    );
  }

  update(dt: number, time: number, env: Environment): void {
    this.bridge.update(dt, time);
    this.marina.update(env, time);
    this.sandbar.update(env, time);
    this.beach.update(time, { x: env.wind.dirX * env.wind.speed, z: env.wind.dirZ * env.wind.speed });
  }
}
