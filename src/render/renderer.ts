import * as THREE from 'three';
import { AIRCRAFT, AIRCRAFT_TYPES, AircraftId, AircraftSpec } from '../sim/aircraft';
import { ControlInputs, HelicopterState } from '../sim/state';
import { LandingArea, World } from '../world/world';
import { HelicopterModel, buildHelicopter } from './helicopterModel';
import { WaterSpray } from './waterSpray';
import { FireFx } from './fireFx';
import { Fire } from '../game/fire';
import { Gate, Pad, gateY } from '../game/levels';
import { StatsOverlay } from './statsOverlay';
import { MOON_DIR, NIGHT, buildNightSky, buildWorldLights } from './night';
import { LIGHT, nightLights } from '../world/nightLights';
import { buildAreaMarkers, buildClouds, buildGate, buildPad, buildObstacles, buildRunways, buildSky, buildTargetBeacon, buildTerrain, buildWater } from './worldMesh';

export type CameraMode = 'cockpit' | 'chase';

const HAZE = 0xe6dcc6;
const DAY = { hemiSky: 0xbcd4f0, hemiGround: 0x4f5a3c, hemi: 1.0, sun: 0xffdcb0, sunPower: 2.4, cloud: 0xf4eee2, cloudGlow: 0x9a9288, beacon: 0xffe14d, blobShadow: 0.3, environment: 0.9 };
/** Exposure under tone mapping, tuned so the scene is as bright as it was without it. */
const TONE_EXPOSURE = 1.0;
const SUN_DIR = new THREE.Vector3(-0.6, 0.45, 0.4).normalize();
const ENDS = [-1, 1] as const;
const SWEEP_RATE = 12; // rad/s of the cockpit rotor sweep at 100 % NR

/**
 * A tiny pre-filtered environment map of the day sky (blue above, warm haze at the horizon, green-brown ground),
 * built once on the GPU: no image is downloaded.
 */
function buildSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const p = geo.attributes.position, colors: number[] = [];
  const top = new THREE.Color(0x5b8fd0), horizon = new THREE.Color(HAZE), ground = new THREE.Color(0x4a5236), sun = new THREE.Color(0xfff0d0), c = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    if (y >= 0) c.copy(horizon).lerp(top, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
    c.lerp(sun, 0.8 * Math.pow(Math.max(0, v.fromBufferAttribute(p, i).normalize().dot(SUN_DIR)), 24));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  return tex;
}

/** Owns the Three.js scene. Reads simulation state; never changes it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** One model per helicopter type, built on first use; `heli` is the one on screen. */
  private models = new Map<AircraftSpec, HelicopterModel>();
  private heli: HelicopterModel;
  private heliSpec: AircraftSpec = AIRCRAFT;
  private beacon: THREE.Group;
  private beaconColumn: THREE.MeshBasicMaterial;
  private markers: THREE.Group | null = null;
  private gates: THREE.Mesh[] = [];
  private pads: THREE.Group[] = [];
  private sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private clouds: THREE.MeshLambertMaterial;
  private nightSky: THREE.Mesh | null = null;
  private worldLights: ReturnType<typeof buildWorldLights> | null = null;
  private towerLight: THREE.Object3D | undefined;
  private runway: LandingArea | undefined;
  /** Moonlit night instead of the late-afternoon day. Changes only what is seen. */
  private night = false;
  private lightDir = SUN_DIR;
  private shadow: THREE.Mesh;
  private chasePos = new THREE.Vector3();
  // Scratch vectors, reused every frame so the render loop allocates nothing.
  private outlet = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private projected = new THREE.Vector3();
  /** Cap on the pixel ratio; lowered by `lowerQuality` on devices that cannot keep up. */
  private maxPixelRatio = 1.5;
  /** Height of the surface a water drop lands on: the ground, or the lake. */
  private surfaceHeight = (x: number, z: number) => Math.max(this.world.heightAt(x, z), this.world.surfaceAt(x, z) === 'water' ? this.world.waterLevel : -1e9);
  private spray = new WaterSpray();
  private dropping = false;
  private fireFx: FireFx | null = null;
  private rotorAngle = 0;
  private tailAngle = 0;
  private sweepAngle = 0;
  private stats: StatsOverlay | null;
  mode: CameraMode = 'chase';
  /** Real shadow map under the helicopter; when off, a blob shadow is drawn instead. */
  shadows = true;

  constructor(
    private container: HTMLElement,
    private world: World,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.className = 'view';
    // Smooth upscaling where the pixel ratio cap is below the device's (overrides the retro CSS).
    this.renderer.domElement.style.imageRendering = 'auto';
    container.appendChild(this.renderer.domElement);
    // Neutral tone mapping rolls off highlights without shifting hues, so colours stay as authored.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = TONE_EXPOSURE;
    this.stats = StatsOverlay.fromUrl(container);
    // Only the helicopter's paint reads the environment: soft sky reflections on a glossy body.
    this.scene.environment = buildSkyEnvironment(this.renderer);
    this.scene.environmentIntensity = DAY.environment;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);
    // Low, warm late-afternoon sun with a soft sky fill and warm haze.
    this.scene.fog = new THREE.Fog(HAZE, 600, 3400);
    this.scene.background = new THREE.Color(HAZE);
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunPower);
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

    this.sky = buildSky(SUN_DIR);
    const ground = [buildTerrain(world), buildRunways(world), buildWater(world)];
    for (const g of ground) g.traverse((o) => (o.receiveShadow = true));
    const clouds = buildClouds();
    this.clouds = (clouds.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    this.scene.add(this.sky, clouds, ...ground, buildObstacles(world));
    this.towerLight = this.scene.getObjectByName('towerLight');
    this.runway = world.areas.find((a) => a.id === 'runway');
    this.beacon = buildTargetBeacon();
    this.beaconColumn = (this.beacon.getObjectByName('column') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    this.scene.add(this.beacon, this.spray.points);

    this.heli = this.modelFor(AIRCRAFT);
    this.heli.eye.add(this.camera);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: DAY.blobShadow, depthWrite: false }),
    );
    this.scene.add(this.shadow);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private modelFor(spec: AircraftSpec): HelicopterModel {
    let m = this.models.get(spec);
    if (!m) {
      const id = (Object.keys(AIRCRAFT_TYPES) as AircraftId[]).find((k) => AIRCRAFT_TYPES[k].spec === spec) ?? 'light';
      const built = (m = buildHelicopter(id));
      built.root.traverse((o) => (o.castShadow = o !== built.rotorDisc));
      built.rotorSweep.traverse((o) => (o.castShadow = false));
      built.lights.group.traverse((o) => (o.castShadow = false));
      // The landing light lights the ground but never casts a shadow.
      built.lights.spot.castShadow = built.lights.panelGlow.castShadow = false;
      this.scene.add(built.root);
      this.models.set(spec, built);
    }
    return m;
  }

  /** Puts the model of the type being flown on screen, moving the cockpit camera with it. */
  private useModel(spec: AircraftSpec) {
    if (spec === this.heliSpec) return;
    this.heli.root.visible = false;
    this.heli = this.modelFor(spec);
    this.heliSpec = spec;
    this.heli.root.visible = true;
    this.shadow.scale.setScalar(spec.rotorRadius / AIRCRAFT.rotorRadius);
    this.syncHeliLights();
    this.setMode(this.mode);
  }

  /** Only the helicopter being flown shows lights, and only at night. */
  private syncHeliLights() {
    for (const m of this.models.values()) {
      const on = this.night && m === this.heli;
      m.lights.spot.visible = m.lights.panelGlow.visible = on;
      m.lights.group.visible = on;
    }
  }

  /** Shows the fire of the current flight (null clears it). */
  setFire(fire: Fire | null) {
    if (this.fireFx) this.scene.remove(this.fireFx.group);
    this.fireFx = fire ? new FireFx(fire, this.world) : null;
    if (this.fireFx) this.scene.add(this.fireFx.group);
  }

  /** Whether water is leaving the tank; the spray is drawn by the next `render`. */
  setWaterDrop(on: boolean) {
    this.dropping = on;
  }

  /**
   * Day or moonlit night. Every value is set outright in both branches, so going back to day restores it exactly.
   * The sun doubles as the moon; its shadow map is off at night.
   */
  setNight(on: boolean) {
    if (on === this.night) return;
    this.night = on;
    if (on && !this.nightSky) this.scene.add((this.nightSky = buildNightSky(MOON_DIR)));
    if (this.nightSky) this.nightSky.visible = on;
    if (on && !this.worldLights) this.scene.add((this.worldLights = buildWorldLights(nightLights(this.world))).group);
    if (this.worldLights) this.worldLights.group.visible = on;
    if (this.towerLight) this.towerLight.visible = true;
    this.syncHeliLights();
    this.sky.visible = !on;
    const horizon = on ? NIGHT.horizon : HAZE;
    this.scene.fog!.color.setHex(horizon);
    (this.scene.background as THREE.Color).setHex(horizon);
    this.hemi.color.setHex(on ? NIGHT.hemiSky : DAY.hemiSky);
    this.hemi.groundColor.setHex(on ? NIGHT.hemiGround : DAY.hemiGround);
    this.hemi.intensity = on ? NIGHT.hemi : DAY.hemi;
    this.scene.environmentIntensity = on ? NIGHT.environment : DAY.environment;
    this.sun.color.setHex(on ? NIGHT.moon : DAY.sun);
    this.sun.intensity = on ? NIGHT.moonPower : DAY.sunPower;
    this.sun.castShadow = !on;
    this.lightDir = on ? MOON_DIR : SUN_DIR;
    this.clouds.color.setHex(on ? NIGHT.cloud : DAY.cloud);
    this.clouds.emissive.setHex(on ? NIGHT.cloudGlow : DAY.cloudGlow);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = on ? NIGHT.blobShadow : DAY.blobShadow;
    this.beacon.traverse((o) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.color.setHex(DAY.beacon).multiplyScalar(on ? NIGHT.unlit : 1));
  }

  /** Windsocks depend on the wind of the current flight. */
  setWind(fromDeg: number, kt: number) {
    if (this.markers) {
      this.scene.remove(this.markers);
      this.markers.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
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
        m.rotation.y = g.facing ?? Math.atan2(to.x - from.x, to.z - from.z);
        this.scene.add(m);
        return m;
      });
    }
    this.gates.forEach((m, i) => {
      m.visible = gates[i].hiddenUntilNext ? i === next : i >= next;
      (m.material as THREE.MeshBasicMaterial).color.set(i === next ? 0xffd23a : 0xffffff);
    });
  }

  /** Paints the landing spots of a level on the ground (an empty list clears them). */
  setPads(pads: Pad[]) {
    for (const m of this.pads) this.scene.remove(m);
    this.pads = pads.map((p) => {
      const m = buildPad(p.radius, p.kind);
      m.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
      this.scene.add(m);
      return m;
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
    // Native resolution, capped at 1.5x so retina screens don't pay for 4x the pixels;
    // the same on every window size, unlike the old area-based downscale.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical FOV so the horizon stays usable.
    this.camera.fov = h > w * 1.15 ? 88 : this.mode === 'cockpit' ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Trades looks for speed, one step per call: first the real shadow gives way to the blob shadow,
   * then the picture is drawn at the screen's base resolution. Returns false once nothing is left to drop.
   */
  lowerQuality(): boolean {
    // At night the shadow map is already off: dropping it would cost the day its shadow and save nothing now.
    if (this.shadows && !this.night) this.shadows = false;
    else if (this.maxPixelRatio > 1) {
      this.maxPixelRatio = 1;
      this.resize();
    } else return false;
    return true;
  }

  render(s: HelicopterState, c: ControlInputs, look: { yaw: number; pitch: number }, frameDt: number, tipOver = 0) {
    this.useModel(s.aircraft);
    const A = s.aircraft;
    const h = this.heli;
    h.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    h.root.rotation.set(s.pitch, s.yaw, -s.roll - tipOver);

    // Water leaves the belly tank, just below the reference point.
    const outlet = h.root.localToWorld(this.outlet.set(0, -A.skidHeight + 0.4, -0.4));
    this.spray.update(frameDt, this.dropping, outlet, this.velocity.set(s.vel.x, s.vel.y, s.vel.z), this.surfaceHeight);

    this.fireFx?.update(frameDt);

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
    (h.rotorDisc.material as THREE.MeshBasicMaterial).opacity = 0.14 * blur + 0.03;
    // From below, the flat disc reads as a static band across the top of the view, so the
    // cockpit gets faint blade sweeps instead. They turn at a capped, NR-proportional rate
    // (about 2 rev/s at 100 %) that steps smoothly at 60 fps; slow blades use the same angle.
    this.sweepAngle += SWEEP_RATE * spin * Math.min(frameDt, 1 / 30);
    h.rotorDisc.visible = !cockpit;
    h.rotorSweep.visible = cockpit && blur > 0.01;
    h.rotorSweep.rotation.y = this.sweepAngle;
    ((h.rotorSweep.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.2 * blur;
    if (cockpit) h.rotor.rotation.y = this.sweepAngle;
    h.cockpit.visible = cockpit;
    h.exterior.visible = !cockpit;
    // The moon is too dim to cast a shadow worth its cost.
    const realShadow = this.shadows && !this.night;
    h.shadowProxy.visible = cockpit && realShadow;

    if (cockpit) {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(look.pitch - 0.08, look.yaw, 0, 'YXZ');
    } else {
      // The chase camera stands further back from a bigger helicopter.
      const size = A.rotorRadius / AIRCRAFT.rotorRadius;
      const back = 17 * size;
      const desired = this.desired.set(s.pos.x + Math.sin(s.yaw) * back, s.pos.y + 4.5 * size, s.pos.z + Math.cos(s.yaw) * back);
      const ground = this.world.heightAt(desired.x, desired.z) + 2;
      desired.y = Math.max(desired.y, ground);
      if (Number.isNaN(this.chasePos.x)) this.chasePos.copy(desired);
      this.chasePos.lerp(desired, Math.min(1, frameDt * 4));
      this.camera.position.copy(this.chasePos);
      this.camera.lookAt(s.pos.x, s.pos.y + size, s.pos.z);
      if (look.yaw || look.pitch) this.camera.rotateY(look.yaw), this.camera.rotateX(look.pitch);
    }

    this.renderer.shadowMap.enabled = realShadow;
    this.sun.target.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.sun.position.copy(this.lightDir).multiplyScalar(120).add(this.sun.target.position);
    const gy = this.world.heightAt(s.pos.x, s.pos.z);
    this.shadow.position.set(s.pos.x, gy + 0.15, s.pos.z);
    this.shadow.visible = !realShadow && !cockpit && s.pos.y - gy < 60;

    // The column guides from afar but would wash out the helicopter near the target.
    const bd = Math.hypot(s.pos.x - this.beacon.position.x, s.pos.z - this.beacon.position.z);
    this.beaconColumn.opacity = 0.22 * THREE.MathUtils.smoothstep(bd, 40, 250);
    this.beaconColumn.visible = this.beaconColumn.opacity > 0.005;

    this.sky.position.set(s.pos.x, 0, s.pos.z);
    this.nightSky?.position.set(s.pos.x, 0, s.pos.z);
    if (this.night) this.animateNight(s);
    this.renderer.render(this.scene, this.camera);
    this.stats?.frame(this.renderer);
  }

  /** Flashing and direction-dependent lights. Flashes follow simulation time, so a paused game shows them frozen. */
  private animateNight(s: HelicopterState) {
    if (this.towerLight) this.towerLight.visible = s.time % 2 < 1.2;
    // From the pilot's seat the glows would hang in the cabin; the landing light still shines.
    const l = this.heli.lights;
    l.group.visible = this.mode !== 'cockpit';
    l.beacon.visible = s.time % 1 < 0.15;
    const rw = this.runway, wl = this.worldLights;
    if (!rw || !wl) return;
    // A runway end shows green to a pilot approaching it from outside, red to one already past it.
    const along = (s.pos.x - rw.cx) * Math.sin(rw.rotation) + (s.pos.z - rw.cz) * Math.cos(rw.rotation);
    for (const end of ENDS) {
      const color = (wl.ends[end].material as THREE.PointsMaterial).color, want = along * end > rw.halfLength ? LIGHT.green : LIGHT.red;
      if (color.getHex() !== want) color.setHex(want);
    }
  }

  /** Screen position of a world point (for HUD markers), or null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = this.projected.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }
}
