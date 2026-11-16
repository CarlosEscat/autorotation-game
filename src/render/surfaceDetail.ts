import * as THREE from 'three';
import { mulberry32 } from '../world/rng';

/**
 * Subtle surface variation for every world material, from one 128² texture and one shader chunk.
 *
 * The texture's channels are three kinds of noise: R soft blotches, G streaks (stretched down walls they read as
 * rain stains), B fine grain. The chunk samples them in world space: from above on floors and roofs, from the side
 * on walls, blended by the surface normal. So the ground, the runway, buildings and rocks all get variation at a
 * consistent scale, without UVs, and all share one shader program per set of material features. In the mipmaps
 * the noise averages out to neutral, so it fades by itself with distance.
 */

let texture: THREE.DataTexture | null = null;

function detailTexture(): THREE.DataTexture {
  if (texture) return texture;
  const N = 128, rnd = mulberry32(77);
  const noise = () => new Float32Array(N * N).map(() => rnd());
  const blur = (src: Float32Array, rx: number, ry: number) => {
    const out = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0, n = 0;
      for (let dj = -ry; dj <= ry; dj++) for (let di = -rx; di <= rx; di++) (s += src[((j + dj + N) % N) * N + ((i + di + N) % N)]), n++;
      out[j * N + i] = s / n;
    }
    return out;
  };
  const normalise = (v: Float32Array) => {
    let lo = Infinity, hi = -Infinity;
    for (const x of v) (lo = Math.min(lo, x)), (hi = Math.max(hi, x));
    return v.map((x) => (x - lo) / (hi - lo));
  };
  const a = noise(), fine = blur(a, 1, 1), coarse = blur(blur(a, 3, 3), 3, 3);
  const blotch = normalise(fine.map((f, k) => 0.55 * f + 0.45 * coarse[k]));
  const streak = normalise(blur(noise(), 1, 6)); // tall and thin: stains running down
  const grain = normalise(blur(noise(), 0, 0));
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) data.set([blotch[k] * 255, streak[k] * 255, grain[k] * 255, 255], k * 4);
  texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Adds the shared world-space detail to a Lambert material, scaled by `strength` (0 = none, 1 = the default look).
 * Every material using it compiles to the same shader for the same set of other features; the strength is a uniform.
 */
export function withSurfaceDetail<T extends THREE.MeshLambertMaterial>(m: T, strength = 1): T {
  const map = detailTexture();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: map };
    shader.uniforms.detailStrength = { value: strength };
    shader.vertexShader = 'varying vec3 vDetailPos;\nvarying vec3 vDetailNormal;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        mat4 detailModel = modelMatrix * instanceMatrix;
      #else
        mat4 detailModel = modelMatrix;
      #endif
      vDetailPos = (detailModel * vec4(transformed, 1.0)).xyz;
      vDetailNormal = normalize(mat3(detailModel) * objectNormal);`,
    );
    shader.fragmentShader = 'uniform sampler2D detailMap;\nuniform float detailStrength;\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec3 an = abs(vDetailNormal);
        float onTop = smoothstep(0.55, 0.8, an.y);
        vec2 top = vDetailPos.xz;
        vec2 side = vec2(an.x > an.z ? vDetailPos.z : vDetailPos.x, vDetailPos.y);
        float blotch = mix(texture2D(detailMap, side / 5.0).r, 0.55 * texture2D(detailMap, top / 9.0).r + 0.45 * texture2D(detailMap, top / 41.0).r, onTop);
        float streak = (1.0 - onTop) * smoothstep(0.55, 0.9, texture2D(detailMap, vec2(side.x / 2.5, side.y / 14.0)).g);
        float grain = texture2D(detailMap, mix(side, top, onTop) / 1.4).b;
        diffuseColor.rgb *= 1.0 + detailStrength * ((blotch - 0.5) * 0.28 + (grain - 0.5) * 0.08 - streak * 0.14);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'surface-detail';
  return m;
}
