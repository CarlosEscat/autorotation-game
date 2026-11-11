import * as THREE from 'three';

const COUNT = 600;
const PER_SECOND = 220;
const LIFE = 6; // s, in case a drop never meets the ground

/**
 * The water falling from the tank: a pool of point sprites released under the helicopter,
 * carried forward with its speed, slowed by the air and pulled down until they reach the ground.
 * Visual only; the amount of water is tracked by the flight session.
 */
export class WaterSpray {
  readonly points: THREE.Points;
  private pos = new Float32Array(COUNT * 3);
  private vel = new Float32Array(COUNT * 3);
  private age = new Float32Array(COUNT).fill(LIFE);
  private next = 0;
  private owed = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pos.fill(-1e5);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd9efff, size: 1.3, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  /** `origin` and `velocity` are the tank outlet's in world space; `groundAt` gives the surface height under a drop. */
  update(dt: number, emitting: boolean, origin: THREE.Vector3, velocity: THREE.Vector3, groundAt: (x: number, z: number) => number) {
    if (dt <= 0) return;
    this.owed = emitting ? this.owed + PER_SECOND * dt : 0;
    for (; this.owed >= 1; this.owed--) {
      const i = this.next;
      this.next = (this.next + 1) % COUNT;
      const r = () => Math.random() - 0.5;
      // Spread each frame's drops along the path flown, so a fast pass leaves a continuous curtain.
      const back = Math.random() * dt;
      this.pos[i * 3] = origin.x - velocity.x * back + r() * 1.6;
      this.pos[i * 3 + 1] = origin.y + r() * 0.4;
      this.pos[i * 3 + 2] = origin.z - velocity.z * back + r() * 1.6;
      this.vel[i * 3] = velocity.x + r() * 3;
      this.vel[i * 3 + 1] = velocity.y - 4 + r() * 2;
      this.vel[i * 3 + 2] = velocity.z + r() * 3;
      this.age[i] = 0;
    }
    const drag = Math.exp(-dt * 0.9);
    for (let i = 0; i < COUNT; i++) {
      if (this.age[i] >= LIFE) continue;
      const k = i * 3;
      this.age[i] += dt;
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.vel[k + 1] = Math.max(-22, this.vel[k + 1] - 9.81 * dt);
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.age[i] >= LIFE || this.pos[k + 1] <= groundAt(this.pos[k], this.pos[k + 2])) {
        this.age[i] = LIFE;
        this.pos[k + 1] = -1e5;
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
