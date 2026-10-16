// Everything that dresses the scene around Montauk's water.

import { Group } from 'three/webgpu';
import type { Quality } from '../../../render/renderWorld';
import type { Environment } from '../../../sim/environment';
import type { LocationProps, WildlifeInput } from '../../types';
import { Buoys } from './buoys';
import { AmbientGulls } from './gulls';
import { Lighthouse } from './lighthouse';
import { buildShore } from './shore';

export class MontaukProps implements LocationProps {
  readonly group = new Group();
  private readonly lighthouse = new Lighthouse();
  private readonly buoys = new Buoys();
  private readonly gulls: AmbientGulls;
  readonly wildlife: { update(dt: number, inp: WildlifeInput): void };

  constructor(quality: Quality) {
    this.group.name = 'montaukProps';
    this.gulls = new AmbientGulls(quality === 'low' ? 9 : 18);
    this.wildlife = this.gulls;
    this.group.add(this.lighthouse.group, this.buoys.group, buildShore(quality), this.gulls.flock.mesh);
  }

  update(_dt: number, time: number, env: Environment): void {
    this.lighthouse.update(time);
    this.buoys.update(env, time);
  }
}
