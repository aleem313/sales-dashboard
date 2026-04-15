let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume();
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.01);
  } catch {
    // no-op
  }
}

export function playBeep(): void {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    const volume = 0.4;

    // Three-note rising chime: C5 → E5 → G5 (major triad), like a classic notification
    const notes: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 523.25, start: 0.0, dur: 0.15 },
      { freq: 659.25, start: 0.12, dur: 0.15 },
      { freq: 783.99, start: 0.24, dur: 0.28 },
    ];

    for (const n of notes) {
      const gain = c.createGain();
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(volume, now + n.start + 0.01);
      gain.gain.linearRampToValueAtTime(volume * 0.7, now + n.start + n.dur * 0.5);
      gain.gain.linearRampToValueAtTime(0, now + n.start + n.dur);

      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      osc.connect(gain);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch {
    // no-op
  }
}
