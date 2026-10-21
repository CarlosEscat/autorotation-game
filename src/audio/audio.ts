/**
 * Procedural WebAudio sound: rotor "whop" (noise modulated at blade-passage
 * frequency), warning horns and an impact thud. No audio files.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rotorGain!: GainNode;
  private rotorLfo!: OscillatorNode;
  private rotorFilter!: BiquadFilterNode;
  private horn!: OscillatorNode;
  private hornGain!: GainNode;
  muted = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // Rotor: looping noise → low-pass → gain whose level is driven by an LFO.
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass';
    this.rotorFilter.frequency.value = 420;
    this.rotorGain = ctx.createGain();
    this.rotorGain.gain.value = 0.25;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.22;
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'sawtooth';
    this.rotorLfo.frequency.value = 12.7;
    this.rotorLfo.connect(lfoDepth).connect(this.rotorGain.gain);
    noise.connect(this.rotorFilter).connect(this.rotorGain).connect(this.master);
    noise.start();
    this.rotorLfo.start();

    this.horn = ctx.createOscillator();
    this.horn.type = 'square';
    this.horn.frequency.value = 520;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.horn.connect(this.hornGain).connect(this.master);
    this.horn.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  update(rpmPct: number, lowRpmWarning: boolean, time: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = Math.max(0, rpmPct) / 100;
    // Two blades: blade-passage frequency = 2 × rotor revolutions per second.
    this.rotorLfo.frequency.setTargetAtTime(Math.max(0.5, 12.7 * r), t, 0.05);
    this.rotorGain.gain.setTargetAtTime(0.28 * Math.min(1, r * 1.1), t, 0.1);
    this.rotorFilter.frequency.setTargetAtTime(250 + 300 * r, t, 0.1);
    // Low-RPM horn: steady pulsing tone.
    const on = lowRpmWarning && Math.floor(time * 4) % 2 === 0;
    this.hornGain.gain.setTargetAtTime(on ? 0.07 : 0, t, 0.01);
  }

  /** Short alternating chime for the engine failure. */
  failureChime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i % 2 ? 680 : 900;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      o.connect(g).connect(this.master);
      o.start(ctx.currentTime + i * 0.22);
      o.stop(ctx.currentTime + i * 0.22 + 0.22);
    }
  }

  impact(severity: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = 0.25 + severity * 0.6;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 200 + severity * 1200;
    const g = ctx.createGain();
    g.gain.value = 0.3 + severity * 0.7;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
