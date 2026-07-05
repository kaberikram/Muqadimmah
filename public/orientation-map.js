'use strict';

/** Screen-facing axis when phone is held portrait like a laser pointer. */
const DEVICE_AIM = { x: 0, y: 0, z: -1 };

function degToRad(d) {
  return (d * Math.PI) / 180;
}

function normalizeAlpha(alpha) {
  return ((alpha % 360) + 360) % 360;
}

/** W3C Device Orientation: Z (alpha) → X' (beta) → Y'' (gamma). */
function quatFromDeviceOrientation(alphaDeg, betaDeg, gammaDeg) {
  const a = degToRad(normalizeAlpha(alphaDeg));
  const b = degToRad(betaDeg);
  const g = degToRad(gammaDeg);

  const ca = Math.cos(a / 2);
  const sa = Math.sin(a / 2);
  const cb = Math.cos(b / 2);
  const sb = Math.sin(b / 2);
  const cg = Math.cos(g / 2);
  const sg = Math.sin(g / 2);

  return {
    w: ca * cb * cg - sa * sb * sg,
    x: ca * sb * cg - sa * cb * sg,
    y: ca * cb * sg + sa * sb * cg,
    z: sa * cb * cg + ca * sb * sg,
  };
}

function quatInverse(q) {
  const len2 = q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z || 1;
  return { w: q.w / len2, x: -q.x / len2, y: -q.y / len2, z: -q.z / len2 };
}

function quatMultiply(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function rotateVec(q, v) {
  const qv = { w: 0, x: v.x, y: v.y, z: v.z };
  const r = quatMultiply(quatMultiply(q, qv), quatInverse(q));
  return { x: r.x, y: r.y, z: r.z };
}

function computeDecoupledAnglesDeg(orient, center) {
  const qRef = quatFromDeviceOrientation(center.alpha, center.beta, center.gamma);
  const qCur = quatFromDeviceOrientation(orient.alpha, orient.beta, orient.gamma);
  const qDelta = quatMultiply(quatInverse(qRef), qCur);
  const localAim = rotateVec(qDelta, DEVICE_AIM);
  const denom = Math.max(Math.abs(localAim.z), 1e-6);
  const panDeg = (Math.atan2(-localAim.x, -Math.sign(localAim.z || -1) * denom) * 180) / Math.PI;
  const tiltDeg = (Math.atan2(localAim.y, -Math.sign(localAim.z || -1) * denom) * 180) / Math.PI;
  return { panDeg, tiltDeg };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeDecoupledAnglesDeg,
    quatFromDeviceOrientation,
    DEVICE_AIM,
  };
}

if (typeof window !== 'undefined') {
  window.OrientationMap = { computeDecoupledAnglesDeg };
}
