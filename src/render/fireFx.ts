import * as THREE from 'three';
import { Fire } from '../game/fire';
import { World } from '../world/world';

const SMOKE = 420;
const SMOKE_LIFE = 11; // s

/**
 * Draws a fire: a scorched disc, a clump of flickering flames per burning patch that shrinks as the
 * patch cools, and one smoke column for the whole fire that can be seen from across the valley.
 * Reads the fire's state every frame; never changes it.
 */
export class FireFx {
  readonly group = new THREE.Group();
  /** Outer and inner cone of every tongue of flame: three tongues per patch, two draws for the whole fire. */
  private outer: THREE.InstancedMesh;
  private inner: THREE.InstancedMesh;
  /** Ground position of each tongue (x, y, z), three per patch. */
  private tongues: Float32Array;
  private m4 = new THREE.Matrix4();
  private smoke: THREE.Points;
  private pos = new Float32Array(SMOKE * 3).fill(-1e5);
  private rise = new Float32Array(SMOKE);
  private age = new Float32Array(SMOKE).fill(SMOKE_LIFE);
  private next = 0;
  private owed = 0;
  private time = 0;

  constructor(
    private fire: Fire,
    private world: World,
  ) {
    const scorchGeo = new THREE.CircleGeometry(5.5, 9).rotateX(-Math.PI / 2);
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x17120e, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const outer = new THREE.ConeGeometry(1.7, 5.5, 5).translate(0, 2.75, 0);
    const inner = new THREE.ConeGeometry(0.9, 3.4, 5).translate(0, 1.7, 0);
    const orange = new THREE.MeshBasicMaterial({ color: 0xff6a14, transparent: true, opacity: 0.92 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xffd447 });
    const n = fire.cells.length;
    const scorch = new THREE.InstancedMesh(scorchGeo, scorchMat, n);
    this.outer = new THREE.InstancedMesh(outer, orange, n * 3);
    this.inner = new THREE.InstancedMesh(inner, yellow, n * 3);
    this.tongues = new Float32Array(n * 9);
    fire.cells.forEach((c, i) => {
      const y = world.heightAt(c.x, c.z);
      scorch.setMatrixAt(i, this.m4.makeRotationY(i * 1.3).setPosition(c.x, y + 0.15, c.z));
      // Three tongues of flame around the centre, each with a brighter core.
      for (let k = 0; k < 3; k++) {
        const a = i * 2.1 + (k * Math.PI * 2) / 3;
        this.tongues.set([c.x + Math.cos(a) * 1.8, y, c.z + Math.sin(a) * 1.8], (i * 3 + k) * 3);
      }
    });
    this.flicker();
    // Bounds are taken with every flame at full size, so culling stays right as they shrink.
    for (const m of [scorch, this.outer, this.inner]) m.computeBoundingSphere();
    this.group.add(scorch, this.outer, this.inner);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x3b3733, size: 11, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false }));
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
  }

  /** Sizes every tongue for its patch's heat and the current flicker; a patch that is out shrinks to nothing. Returns how many burn. */
  private flicker(): number {
    const cells = this.fire.cells, t = this.tongues, m = this.m4;
    let burning = 0;
    for (let i = 0; i < cells.length; i++) {
      const heat = cells[i].heat;
      if (heat > 0) burning++;
      const size = heat > 0 ? 0.35 + 0.65 * heat : 0;
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        const f = 0.8 + 0.2 * Math.sin(this.time * (7 + k * 1.9) + i * 1.7 + k * 2.1);
        m.makeScale(size, size * f, size).setPosition(t[j * 3], t[j * 3 + 1], t[j * 3 + 2]);
        this.outer.setMatrixAt(j, m);
        this.inner.setMatrixAt(j, m);
      }
    }
    this.outer.instanceMatrix.needsUpdate = this.inner.instanceMatrix.needsUpdate = true;
    return burning;
  }

  update(dt: number) {
    this.time += dt;
    const cells = this.fire.cells;
    const burning = this.flicker();
    if (dt <= 0) return;

    // Smoke: more of it the more patches burn, rising and leaning a little downwind.
    this.owed = burning ? this.owed + Math.min(34, 6 + burning * 3) * dt : 0;
    for (; this.owed >= 1; this.owed--) {
      // A random burning patch: the n-th one still alight.
      let pick = Math.floor(Math.random() * burning);
      const c = cells.find((cell) => cell.heat > 0 && pick-- === 0)!;
      const i = this.next;
      this.next = (this.next + 1) % SMOKE;
      this.pos[i * 3] = c.x + (Math.random() - 0.5) * 5;
      this.pos[i * 3 + 1] = this.world.heightAt(c.x, c.z) + 3 + Math.random() * 3;
      this.pos[i * 3 + 2] = c.z + (Math.random() - 0.5) * 5;
      this.rise[i] = 5 + Math.random() * 4;
      this.age[i] = 0;
    }
    for (let i = 0; i < SMOKE; i++) {
      if (this.age[i] >= SMOKE_LIFE) continue;
      this.age[i] += dt;
      const k = i * 3;
      this.pos[k] += (1.2 + this.age[i] * 0.25) * dt;
      this.pos[k + 1] += this.rise[i] * dt;
      this.pos[k + 2] += 0.6 * dt;
      if (this.age[i] >= SMOKE_LIFE) this.pos[k + 1] = -1e5;
    }
    (this.smoke.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
