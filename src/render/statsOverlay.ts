import * as THREE from 'three';

/**
 * Frame rate and draw counters in a corner of the screen, for checking performance on a real device.
 * Shown only with `?stats` in the address (production builds too), so players never see it.
 */
export class StatsOverlay {
  private el: HTMLDivElement;
  private frames = 0;
  private since = performance.now();
  private worst = 0;
  private last = performance.now();

  static fromUrl(container: HTMLElement): StatsOverlay | null {
    return new URLSearchParams(location.search).has('stats') ? new StatsOverlay(container) : null;
  }

  private constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:4px;bottom:4px;z-index:50;font:11px/1.3 monospace;color:#fff;background:rgba(0,0,0,.55);padding:3px 6px;pointer-events:none;white-space:pre';
    container.appendChild(this.el);
  }

  /** Call once per drawn frame, after rendering. */
  frame(renderer: THREE.WebGLRenderer) {
    const now = performance.now();
    this.worst = Math.max(this.worst, now - this.last);
    this.last = now;
    this.frames++;
    if (now - this.since < 500) return;
    const fps = (this.frames * 1000) / (now - this.since);
    const i = renderer.info;
    this.el.textContent =
      `${fps.toFixed(0)} fps  worst ${this.worst.toFixed(0)} ms\n` +
      `${i.render.calls} calls  ${(i.render.triangles / 1000).toFixed(0)}k tris\n` +
      `${i.memory.geometries} geo  ${i.memory.textures} tex  ${i.programs?.length ?? 0} prog  @${renderer.getPixelRatio()}x`;
    this.frames = 0;
    this.worst = 0;
    this.since = now;
  }
}
