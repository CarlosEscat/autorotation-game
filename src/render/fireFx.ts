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
  private flames: THREE.Group[] = [];
  private phase: number[] = [];
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
    fire.cells.forEach((c, i) => {
      const y = world.heightAt(c.x, c.z);
      const scorch = new THREE.Mesh(scorchGeo, scorchMat);
      scorch.position.set(c.x, y + 0.15, c.z);
      scorch.rotation.y = i * 1.3;
      const clump = new THREE.Group();
      clump.position.set(c.x, y, c.z);
      // Three tongues of flame around the centre, each with a brighter core.
      for (let k = 0; k < 3; k++) {
        const a = i * 2.1 + (k * Math.PI * 2) / 3;
        const tongue = new THREE.Group();
        tongue.position.set(Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8);
        tongue.add(new THREE.Mesh(outer, orange), new THREE.Mesh(inner, yellow));
        clump.add(tongue);
      }
      this.flames.push(clump);
      this.phase.push(i * 1.7);
      this.group.add(scorch, clump);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x3b3733, size: 11, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false }));
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
  }

  update(dt: number) {
    this.time += dt;
    const cells = this.fire.cells;
    let burning = 0;
    cells.forEach((c, i) => {
      const clump = this.flames[i];
      clump.visible = c.heat > 0;
      if (!clump.visible) return;
      burning++;
      const size = 0.35 + 0.65 * c.heat;
      clump.children.forEach((t, k) => {
        const f = 0.8 + 0.2 * Math.sin(this.time * (7 + k * 1.9) + this.phase[i] + k * 2.1);
        t.scale.set(size, size * f, size);
      });
    });
    if (dt <= 0) return;

    // Smoke: more of it the more patches burn, rising and leaning a little downwind.
    this.owed = burning ? this.owed + Math.min(34, 6 + burning * 3) * dt : 0;
    const lit = cells.filter((c) => c.heat > 0);
    for (; this.owed >= 1 && lit.length; this.owed--) {
      const c = lit[Math.floor(Math.random() * lit.length)];
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
