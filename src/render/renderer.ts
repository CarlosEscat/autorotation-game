import * as THREE from 'three';
import { AIRCRAFT as A } from '../sim/aircraft';
import { ControlInputs, HelicopterState } from '../sim/state';
import { LandingArea, World } from '../world/world';
import { HelicopterModel, buildHelicopter } from './helicopterModel';
import { Gate, gateY } from '../game/levels';
import { buildAreaMarkers, buildClouds, buildGate, buildObstacles, buildRunways, buildSky, buildTargetBeacon, buildTerrain, buildWater } from './worldMesh';

export type CameraMode = 'cockpit' | 'chase';

const HAZE = 0xe6dcc6;
const SUN_DIR = new THREE.Vector3(-0.6, 0.45, 0.4).normalize();

/** Owns the Three.js scene. Reads simulation state; never changes it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private heli: HelicopterModel;
  private beacon: THREE.Group;
  private markers: THREE.Group | null = null;
  private gates: THREE.Mesh[] = [];
  private sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private shadow: THREE.Mesh;
  private chasePos = new THREE.Vector3();
  private rotorAngle = 0;
  private tailAngle = 0;
  mode: CameraMode = 'cockpit';
  /** Real shadow map under the helicopter; when off, a blob shadow is drawn instead. */
  shadows = true;

  constructor(
    private container: HTMLElement,
    private world: World,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.domElement.className = 'view';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);
    // Low, warm late-afternoon sun with a soft sky fill and warm haze.
    this.scene.fog = new THREE.Fog(HAZE, 450, 2800);
    this.scene.background = new THREE.Color(HAZE);
    this.scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x4f5a3c, 1.0));
    this.sun = new THREE.DirectionalLight(0xffdcb0, 2.4);
    this.sun.position.copy(SUN_DIR);
    this.scene.add(this.sun, this.sun.target);

    // One small shadow map that follows the helicopter: only the helicopter casts.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -35;
    sc.right = sc.top = 35;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;

    this.sky = buildSky();
    const ground = [buildTerrain(world), buildRunways(world), buildWater(world)];
    for (const g of ground) g.traverse((o) => (o.receiveShadow = true));
    this.scene.add(this.sky, buildClouds(), ...ground, buildObstacles(world));
    this.beacon = buildTargetBeacon();
    this.scene.add(this.beacon);

    this.heli = buildHelicopter();
    this.heli.root.traverse((o) => (o.castShadow = o !== this.heli.rotorDisc));
    this.scene.add(this.heli.root);
    this.heli.eye.add(this.camera);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.scene.add(this.shadow);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Windsocks depend on the wind of the current flight. */
  setWind(fromDeg: number, kt: number) {
    if (this.markers) this.scene.remove(this.markers);
    this.markers = buildAreaMarkers(this.world, fromDeg, kt);
    this.scene.add(this.markers);
  }

  setTarget(area: LandingArea | null) {
    this.beacon.visible = !!area;
    if (area) this.beacon.position.set(area.cx, area.elevation, area.cz);
  }

  /** Shows the gates of a gate level; gates before `next` are hidden, the next one is yellow. */
  setGates(gates: Gate[], next: number) {
    if (this.gates.length !== gates.length) {
      for (const m of this.gates) this.scene.remove(m);
      this.gates = gates.map((g, i) => {
        const m = buildGate(g.radius);
        const to = gates[i + 1] ?? g;
        const from = gates[i + 1] ? g : (gates[i - 1] ?? g);
        m.position.set(g.x, gateY(g, this.world), g.z);
        m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
        this.scene.add(m);
        return m;
      });
    }
    this.gates.forEach((m, i) => {
      m.visible = i >= next;
      (m.material as THREE.MeshBasicMaterial).color.set(i === next ? 0xffd23a : 0xffffff);
    });
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    if (mode === 'cockpit') this.heli.eye.add(this.camera);
    else this.scene.add(this.camera);
    this.chasePos.set(Number.NaN, 0, 0);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // Render at reduced resolution and scale up with crisp pixels for the retro look.
    const scale = Math.min(window.devicePixelRatio || 1, 2) * (w * h > 1.4e6 ? 0.5 : 0.62);
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical FOV so the horizon stays usable.
    this.camera.fov = h > w * 1.15 ? 88 : this.mode === 'cockpit' ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  render(s: HelicopterState, c: ControlInputs, look: { yaw: number; pitch: number }, frameDt: number, tipOver = 0) {
    const h = this.heli;
    h.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    h.root.rotation.set(s.pitch, s.yaw, -s.roll - tipOver);

    this.rotorAngle += s.omega * frameDt;
    this.tailAngle += s.omega * 5.5 * frameDt;
    h.rotor.rotation.y = this.rotorAngle;
    h.tailRotor.rotation.x = this.tailAngle;

    h.cyclic.rotation.x = c.cyclicPitch * 0.28;
    h.cyclic.rotation.z = -c.cyclicRoll * 0.28;
    h.collective.rotation.x = c.collective * 0.4 - 0.1;

    const cockpit = this.mode === 'cockpit';
    // Per-frame blade steps strobe at speed, so blades fade into a soft disc as NR builds.
    // Blades are only visible while the rotor is slow, which doubles as a low-NR cue.
    const spin = Math.min(1, s.omega / A.rotorOmega0);
    const blur = THREE.MathUtils.smoothstep(spin, 0.4, 0.85);
    h.rotor.visible = blur < 0.7;
    (h.rotorDisc.material as THREE.MeshBasicMaterial).opacity = (cockpit ? 0.06 : 0.14) * blur + 0.03;
    h.cockpit.visible = cockpit;
    h.exterior.visible = !cockpit;
    h.shadowProxy.visible = cockpit && this.shadows;

    if (cockpit) {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(look.pitch - 0.08, look.yaw, 0, 'YXZ');
    } else {
      const back = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(17);
      const desired = new THREE.Vector3(s.pos.x + back.x, s.pos.y + 4.5, s.pos.z + back.z);
      const ground = this.world.heightAt(desired.x, desired.z) + 2;
      desired.y = Math.max(desired.y, ground);
      if (Number.isNaN(this.chasePos.x)) this.chasePos.copy(desired);
      this.chasePos.lerp(desired, Math.min(1, frameDt * 4));
      this.camera.position.copy(this.chasePos);
      this.camera.lookAt(s.pos.x, s.pos.y + 1, s.pos.z);
      if (look.yaw || look.pitch) this.camera.rotateY(look.yaw), this.camera.rotateX(look.pitch);
    }

    this.renderer.shadowMap.enabled = this.shadows;
    this.sun.target.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120).add(this.sun.target.position);
    const gy = this.world.heightAt(s.pos.x, s.pos.z);
    this.shadow.position.set(s.pos.x, gy + 0.15, s.pos.z);
    this.shadow.visible = !this.shadows && !cockpit && s.pos.y - gy < 60;

    this.sky.position.set(s.pos.x, 0, s.pos.z);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position of a world point (for HUD markers), or null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }
}
