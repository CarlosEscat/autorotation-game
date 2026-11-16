// Dev-only capture harness for visual before/after comparisons (see docs/visual-baseline/README.md).
// Evaluate in a page running `npm run dev`; it relies on the `window.__game` dev hook.
// Installs: __view(name, night) to frame a fixed shot, and __stats() for renderer counters.
async () => {
  const g = window.__game;
  if (!window.__harness) {
    g.startFreeFlight(g.saved.settings);
    await new Promise((r) => setTimeout(r, 400));
    g.pause();
    const R = g.renderer;
    const orig = R.render.bind(R);
    window.__cam = null;
    // After the game's own draw, redraw from a fixed camera when a view asks for one.
    R.render = (...a) => {
      orig(...a);
      const c = window.__cam;
      if (!c) return;
      if (R.camera.parent !== R.scene) R.scene.add(R.camera);
      R.camera.position.set(...c.pos);
      R.camera.lookAt(...c.look);
      R.camera.updateMatrixWorld();
      R.renderer.render(R.scene, R.camera);
    };
    const st = document.createElement('style');
    st.textContent = '#app > *:not(canvas){visibility:hidden !important}';
    document.head.appendChild(st);
    window.__place = (x, y, z, yaw = 0, pitch = 0, roll = 0) => {
      const s = g.session.state;
      Object.assign(s.pos, { x, y, z });
      Object.assign(s, { yaw, pitch, roll });
      R.chasePos.set(NaN, 0, 0);
    };
    // Fixed shots. The light helicopter rests on the runway at y = ground + skid height.
    window.__views = {
      heli: { parked: true, place: [-175, 'ground', -600, 0], cam: { pos: [-182, 3.6, -605.5], look: [-175, 1.5, -600.6] } },
      heavy: { parked: true, place: [-175, 'ground', -600, 0], heavy: true, cam: { pos: [-189, 5, -611], look: [-175, 1.5, -601] } },
      chase: { place: [-60, 160, 300, 0.4, -0.05, 0.1], cam: null },
      airport: { place: [-175, 'ground', -600, 0.6], cam: { pos: [-60, 70, -380], look: [-210, 0, -560] } },
      lake: { place: [60, 400, 900], cam: { pos: [200, 55, 520], look: [60, -2, 260] } },
      farm: { place: [60, 400, 900], cam: { pos: [520, 40, 230], look: [400, -5, 420] } },
      vista: { place: [60, 400, 900], cam: { pos: [-200, 220, 1100], look: [100, 40, -600] } },
      cockpit: { place: [-40, 140, 350, 0.3, -0.12], cam: null, cockpit: true },
      forest: { place: [60, 400, 900], cam: { pos: [140, 'ground+14', -560], look: [240, 'ground+8', -650] } },
      low: { place: [-470, 'ground+4', 300, 2.4, -0.04], cam: null },
    };
    window.__view = async (name, night = false) => {
      const R = g.renderer, v = __views[name];
      const type = v.heavy ? 'heavy' : 'light';
      if (window.__type !== type) {
        g.startFreeFlight({ ...g.saved.settings, aircraft: type, time: 'day' });
        await new Promise((r) => setTimeout(r, 300));
        g.pause();
        window.__type = type;
      }
      R.setNight(night);
      R.setMode(v.cockpit ? 'cockpit' : 'chase');
      // 'ground+N' places a point N metres above the terrain under it.
      const lift = (x, y, z) => (typeof y === 'string' && y.startsWith('ground+') ? g.world.heightAt(x, z) + Number(y.slice(7)) : y);
      if (v.cam) v.cam = { pos: [v.cam.pos[0], lift(...v.cam.pos), v.cam.pos[2]], look: [v.cam.look[0], lift(...v.cam.look), v.cam.look[2]] };
      const p = [...v.place];
      p[1] = lift(p[0], p[1], p[2]);
      // Shots on the ground: y = 'ground' sits the gear on the terrain.
      if (p[1] === 'ground') p[1] = g.world.heightAt(p[0], p[2]) + g.session.state.aircraft.skidHeight;
      __place(...p);
      // Parked shots stop the rotor so the blades show (a turning rotor is drawn as a faint disc).
      g.session.state.omega = v.parked ? 0 : g.session.state.aircraft.rotorOmega0;
      if (v.parked) R.rotorAngle = 0.4;
      window.__cam = v.cam;
      await new Promise((r) => setTimeout(r, 400));
      return name;
    };
    window.__stats = () => {
      const i = g.renderer.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length };
    };
    window.__harness = true;
  }
  return 'ok';
};
