// Shared gradient palettes. A palette is a list of stops { t, r, g, b } where
// t is a semantic gradient position (0 = hot core, 1 = cool rim) and r/g/b are
// 0–255. lerpStops returns 0..1 floats.

import { clamp } from './math.js';

export const PALETTES = [
  { name: 'SOLAR', stops: [
    { t: 0.0, r: 255, g: 244, b: 222 },
    { t: 0.5, r: 255, g: 205, b: 150 },
    { t: 0.8, r: 255, g: 150, b: 110 },
    { t: 1.0, r: 150, g: 125, b: 255 },
  ] },
  { name: 'SPECTRE', stops: [
    { t: 0.0, r: 230, g: 252, b: 255 },
    { t: 0.5, r: 110, g: 215, b: 255 },
    { t: 0.8, r: 120, g: 140, b: 255 },
    { t: 1.0, r: 160, g: 90, b: 255 },
  ] },
  { name: 'VENOM', stops: [
    { t: 0.0, r: 240, g: 255, b: 225 },
    { t: 0.5, r: 120, g: 255, b: 140 },
    { t: 0.8, r: 45, g: 220, b: 180 },
    { t: 1.0, r: 30, g: 140, b: 210 },
  ] },
  { name: 'CRIMSON', stops: [
    { t: 0.0, r: 255, g: 238, b: 228 },
    { t: 0.5, r: 255, g: 105, b: 90 },
    { t: 0.8, r: 235, g: 65, b: 130 },
    { t: 1.0, r: 150, g: 55, b: 220 },
  ] },
  { name: 'MONO', stops: [
    { t: 0.0, r: 255, g: 255, b: 255 },
    { t: 0.5, r: 205, g: 205, b: 210 },
    { t: 0.8, r: 160, g: 160, b: 175 },
    { t: 1.0, r: 105, g: 105, b: 125 },
  ] },
];

// Fixed palette for anything that should stay spectral regardless of choice.
export const GHOST_STOPS = PALETTES[1].stops;

export function lerpStops(stops, t) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t || 1);
      return {
        r: (a.r + (b.r - a.r) * localT) / 255,
        g: (a.g + (b.g - a.g) * localT) / 255,
        b: (a.b + (b.b - a.b) * localT) / 255,
      };
    }
  }
  const last = stops[stops.length - 1];
  return { r: last.r / 255, g: last.g / 255, b: last.b / 255 };
}

/**
 * Palette cycler with a cross-fade between the outgoing and incoming gradient.
 * `animate` is injected (anime.js) so this module stays DOM- and import-free;
 * `cycle` returns the new palette name for the caller to surface however it likes.
 */
export function makePalette({ animate, duration = 350 } = {}) {
  let index = 0;
  let fromStops = PALETTES[0].stops;
  const blend = { v: 1 };

  function lerp(t) {
    const to = lerpStops(PALETTES[index].stops, t);
    const v = blend.v;
    if (v >= 1) return to;
    const from = lerpStops(fromStops, t);
    return {
      r: from.r + (to.r - from.r) * v,
      g: from.g + (to.g - from.g) * v,
      b: from.b + (to.b - from.b) * v,
    };
  }

  function cycle(dir) {
    fromStops = PALETTES[index].stops;
    index = (index + dir + PALETTES.length) % PALETTES.length;
    blend.v = 0;
    if (animate) animate(blend, { v: 1, duration, ease: 'outQuad' });
    else blend.v = 1;
    return PALETTES[index].name;
  }

  return {
    lerp,
    cycle,
    get index() { return index; },
    get name() { return PALETTES[index].name; },
  };
}
