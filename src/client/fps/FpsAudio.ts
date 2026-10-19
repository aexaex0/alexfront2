// Sound for the FPS mode, synthesized with WebAudio (no sound files):
// gunshots near and far, reloads, hit ticks, damage and capture jingles.

type AudioCtor = typeof AudioContext;

export class FpsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Recent sound start times, to cap how many play at once. */
  private recent: number[] = [];
  muted = false;

  /** Must run from a user gesture (a click) before anything is audible. */
  unlock(): void {
    if (!this.ctx) {
      const w = window as unknown as {
        AudioContext?: AudioCtor;
        webkitAudioContext?: AudioCtor;
      };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      // Sound only, never game state: plain Math.random is fine here.
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== "running")
      return null;
    const now = this.ctx.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.12);
    if (this.recent.length > 14) return null;
    this.recent.push(now);
    return this.ctx;
  }

  private out(ctx: AudioContext, pan: number): AudioNode {
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.master!);
      return p;
    }
    return this.master!;
  }

  private noiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    at: number,
    dur: number,
    vol: number,
    type: BiquadFilterType,
    freq: number,
    q = 0.7,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(at, Math.random() * 0.8, dur + 0.05);
  }

  private tone(
    ctx: AudioContext,
    dest: AudioNode,
    at: number,
    dur: number,
    vol: number,
    f0: number,
    f1: number,
    type: OscillatorType = "sine",
  ): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A rifle shot; `distant` ones are duller and quieter. */
  shot(volume: number, pan: number, distant: boolean): void {
    const ctx = this.ready();
    if (!ctx || volume <= 0.01) return;
    const at = ctx.currentTime;
    const dest = this.out(ctx, pan);
    if (distant) {
      this.noiseBurst(ctx, dest, at, 0.28, 0.5 * volume, "lowpass", 900);
      this.tone(ctx, dest, at, 0.16, 0.35 * volume, 90, 35);
    } else {
      this.noiseBurst(ctx, dest, at, 0.16, 0.9 * volume, "lowpass", 4200);
      this.noiseBurst(ctx, dest, at, 0.05, 0.5 * volume, "highpass", 2500);
      this.tone(ctx, dest, at, 0.13, 0.75 * volume, 140, 42);
      this.tone(
        ctx,
        dest,
        at + 0.005,
        0.02,
        0.08 * volume,
        1900,
        1500,
        "square",
      );
    }
  }

  reload(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    const d = this.master!;
    this.noiseBurst(ctx, d, at + 0.15, 0.06, 0.35, "bandpass", 1800, 3);
    this.noiseBurst(ctx, d, at + 0.95, 0.07, 0.4, "bandpass", 1400, 3);
    this.tone(ctx, d, at + 0.97, 0.04, 0.12, 900, 600, "square");
    this.noiseBurst(ctx, d, at + 1.5, 0.05, 0.4, "bandpass", 2400, 4);
    this.noiseBurst(ctx, d, at + 1.62, 0.06, 0.45, "bandpass", 1900, 4);
  }

  hit(head: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(
      ctx,
      this.master!,
      at,
      0.06,
      0.25,
      head ? 2100 : 1500,
      head ? 1900 : 1300,
      "triangle",
    );
    if (head) this.tone(ctx, this.master!, at + 0.05, 0.18, 0.18, 2600, 2500);
  }

  hurt(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(ctx, this.master!, at, 0.18, 0.5, 110, 50);
    this.noiseBurst(ctx, this.master!, at, 0.12, 0.3, "lowpass", 500);
  }

  kill(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(ctx, this.master!, at, 0.12, 0.22, 880, 870, "triangle");
    this.tone(ctx, this.master!, at + 0.09, 0.22, 0.22, 1320, 1310, "triangle");
  }

  capture(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      this.tone(ctx, this.master!, at + i * 0.11, 0.3, 0.2, f, f, "triangle");
    });
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
