// Audio-reactive input: an analyser over getUserMedia split into three bands
// plus a beat detector. Works with a mic, a USB audio interface, or a virtual
// loopback device — whatever the browser reports as the default input.

import { smoothFollow } from './math.js';

function bandAverage(data, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i];
  return sum / ((to - from) * 255);
}

/**
 * `onBeat` fires on each detected kick so the caller decides what a beat means
 * (a burst, a cut, nothing). `isTestMode` short-circuits device access so CI
 * never prompts for a microphone.
 */
export function createAudio({ isTestMode = false, onBeat = null } = {}) {
  const audio = { bass: 0, mid: 0, treb: 0, level: 0, beatPulse: 0 };
  let enabled = false;
  let state = null;
  let lastBeatAt = 0;

  function disable() {
    if (state) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.ctx.close();
      state = null;
    }
    enabled = false;
    audio.bass = audio.mid = audio.treb = audio.level = audio.beatPulse = 0;
  }

  // Resolves to a status string the caller can surface: ON / OFF / UNAVAILABLE / DENIED
  async function toggle() {
    if (enabled) {
      disable();
      return 'OFF';
    }
    if (isTestMode) {
      enabled = true;
      return 'ON';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return 'UNAVAILABLE';
    }
    try {
      // All three processing flags off — a board mix must not be gated or gain-ridden.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      state = {
        ctx, stream, analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
        bassSlow: 0,
      };
      enabled = true;
      return 'ON';
    } catch (err) {
      return 'DENIED';
    }
  }

  function update(dt, now) {
    audio.beatPulse *= Math.exp(-5 * dt);
    if (!enabled || !state) return;

    state.analyser.getByteFrequencyData(state.data);
    // ~47 Hz/bin at 48 kHz / fftSize 1024. The AudioContext resamples whatever
    // the device runs at, so these bounds hold regardless of interface rate.
    const bass = bandAverage(state.data, 1, 6);     // ~47–280 Hz
    const mid = bandAverage(state.data, 6, 48);     // ~280 Hz–2.2 kHz
    const treb = bandAverage(state.data, 48, 220);  // ~2.2–10 kHz

    audio.bass = smoothFollow(audio.bass, bass, 14, dt);
    audio.mid = smoothFollow(audio.mid, mid, 10, dt);
    audio.treb = smoothFollow(audio.treb, treb, 10, dt);
    audio.level = audio.bass * 0.5 + audio.mid * 0.35 + audio.treb * 0.15;

    // Beat: bass spikes above its own rolling average
    state.bassSlow = state.bassSlow * 0.985 + bass * 0.015;
    const isBeat = bass > Math.max(0.22, state.bassSlow * 1.45) && now - lastBeatAt > 180;
    if (isBeat) {
      lastBeatAt = now;
      audio.beatPulse = 1;
      if (onBeat) onBeat();
    }
  }

  return {
    audio,
    toggle,
    disable,
    update,
    get enabled() { return enabled; },
  };
}
