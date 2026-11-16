import * as THREE from 'three';

/**
 * Height fog with aerial perspective, for every fogged material at once.
 *
 * three's linear fog is the same at every height. Here the haze is densest near the valley floor and thins out
 * exponentially with altitude (integrated along the line of sight, so looking down from high up shows a clear
 * landscape and looking along a valley shows depth), and its colour cools from the warm haze towards blue with
 * distance. The scene's linear fog (near/far) stays as a floor, so anything at the far edge of the world still
 * dissolves into the sky. Installed by patching three's fog shader chunks, before any shader compiles.
 */

/** Haze density at the base height, per metre of sight line. */
const DENSITY = 0.00034;
/** Height (m) at which the haze is densest, and the height over which it falls to 1/e. */
const BASE = -10;
const FALLOFF = 130;
/** Far haze is the near haze times this (cooler, bluer): the colour of air seen through a lot of it. */
export const FAR_TINT = new THREE.Color(0.8, 0.9, 1.08);
/** How far towards FAR_TINT the haze has moved at the end of the fog range. */
export const FAR_TINT_AMOUNT = 0.45;

/** The colour the sky must have at the horizon to meet the fogged ground there seamlessly. */
export function horizonColour(haze: THREE.Color): THREE.Color {
  const far = haze.clone().multiply(FAR_TINT);
  return haze.clone().lerp(far, FAR_TINT_AMOUNT);
}

const f = (x: number) => x.toFixed(6);
let installed = false;

export function installHeightFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  // World position from the view-space one (view = rotation R, translation t: world = Rᵀ (view − t)).
  C.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `
#ifdef USE_FOG
  {
    vec3 sight = vFogWorldPos - cameraPosition;
    float dist = length(sight);
    // Mean density along the sight line through haze falling off as exp(-(y - BASE) / FALLOFF).
    float yc = cameraPosition.y - ${f(BASE)}, yf = vFogWorldPos.y - ${f(BASE)}, dy = yf - yc;
    float ec = exp(-max(yc, -200.0) / ${f(FALLOFF)});
    float mean = abs(dy) > 0.5 ? (ec - exp(-max(yf, -200.0) / ${f(FALLOFF)})) * ${f(FALLOFF)} / dy : ec;
    float haze = 1.0 - exp(-${f(DENSITY)} * dist * mean);
    #ifdef FOG_EXP2
      float edge = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      float tintEnd = 3000.0;
    #else
      float edge = smoothstep(fogNear, fogFar, vFogDepth);
      float tintEnd = fogFar;
    #endif
    float fogFactor = max(haze, edge);
    vec3 farColour = fogColor * vec3(${f(FAR_TINT.r)}, ${f(FAR_TINT.g)}, ${f(FAR_TINT.b)});
    vec3 hazeColour = mix(fogColor, farColour, ${f(FAR_TINT_AMOUNT)} * smoothstep(300.0, tintEnd, dist));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColour, fogFactor);
  }
#endif`;
}
