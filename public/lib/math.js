// Frame-rate-independent easing and small numeric helpers shared by the shows.

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function smoothFollow(current, target, rate, dt) {
  const alpha = 1 - Math.exp(-rate * dt);
  return current + (target - current) * alpha;
}

// Shortest-path angle blend toward a target heading.
export function smoothAngle(current, target, rate, dt) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-rate * dt));
}

// Wrap an angle into [−π, π) so a heading can never accumulate whole turns.
export function wrapPi(a) {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

export function gaussRandom() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
