import { MS_TO_KT, RPM } from '../sim/aircraft';
import { DEG } from '../sim/vec';
import { Guidance } from './guidance';
import { FlightSession } from './session';

export type Mode = 'keyboard' | 'touch';

export const KEY_WORDS = {
  keyboard: { down: 'S', up: 'W', fwd: '↑', aft: '↓', turn: '← →', target: 'T' },
  touch: { down: 'slide COLL down', up: 'raise COLL', fwd: 'stick forward', aft: 'stick back', turn: 'stick left/right', target: 'TGT' },
};

/**
 * Contextual coaching for the first attempts. Suggests what to do next; it never
 * touches the controls.
 */
export function contextualHint(session: FlightSession, g: Guidance | null, mode: Mode): string | null {
  const s = session.state;
  const k = KEY_WORDS[mode];
  const kt = s.airspeed * MS_TO_KT;
  const t = session.timeSinceFailure;

  if (session.phase === 'cruise') {
    if (s.time < 2.5) return `Normal cruise. The engine will fail soon. Be ready to lower the collective (${k.down}).`;
    return 'Pick a landing area: follow the yellow beacon and the arrow at the top.';
  }
  if (session.phase !== 'autorotation') return null;

  if (t < 6 && s.collective > session.rec.cruiseCollective * 0.4 + 0.05) return `ENGINE FAILURE! Lower the collective now (${k.down}).`;
  if (s.agl > 60) {
    if (s.rpmPct < RPM.lowWarn) return `Rotor RPM low. Lower the collective (${k.down}).`;
    if (s.rpmPct > RPM.highWarn) return `Rotor RPM high. Raise the collective slightly (${k.up}).`;
    if (kt < 48) return `Too slow, descent rate is rising. Lower the nose (${k.fwd}) for 55–70 kt.`;
    if (kt > 80) return `Too fast. Raise the nose a little (${k.aft}) for 55–70 kt.`;
    if (g && g.reach === 'short') return `Selected area looks too far. Try a closer one (${k.target}).`;
    if (g && Math.abs(g.relBearing) > 25 * DEG) return `Turn toward the beacon (${k.turn}).`;
    if (t < 12) return 'Good entry. Hold about 60 kt and keep the rotor in the green.';
    return null;
  }
  if (s.agl > 25) return 'Approaching the ground. Get ready to flare at about 50 ft.';
  if (s.agl > 6) return s.pitch < 8 * DEG ? `FLARE: pull the cyclic back (${k.aft}).` : 'Hold the flare to slow down and stop the sink.';
  return `Level the skids (${k.fwd}) and raise the collective to cushion (${k.up}).`;
}
