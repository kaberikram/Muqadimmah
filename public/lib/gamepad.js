// Gamepad polling: standard-mapping button indices, a radial dead zone with an
// expo curve, and edge/hold/analog accessors over the previous frame's state.

// Standard-mapping button indices (Xbox layout).
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,      // analog
  RT: 7,      // analog
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

export const STICK_DEADZONE = 0.12;
export const STICK_EXPO = 1.6;

export function activeGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (gp && gp.connected) return gp;
  }
  return null;
}

// Radial dead zone, then an expo curve on the magnitude with direction preserved.
export function applyStickCurve(ax, ay, deadzone = STICK_DEADZONE) {
  const mag = Math.hypot(ax, ay);
  if (mag < deadzone) return { x: 0, y: 0, mag: 0 };
  const scaled = Math.pow((mag - deadzone) / (1 - deadzone), STICK_EXPO);
  return { x: (ax / mag) * scaled, y: (ay / mag) * scaled, mag: scaled };
}

const ZERO_STICK = { x: 0, y: 0, mag: 0 };

/**
 * Owns the previous-frame button snapshot so `edge()` can't be broken by
 * forgetting to update it last. `poll()` returns a frame view; call it once per
 * frame and read everything off the result.
 *
 * `onMappingWarning` fires once if a non-standard pad shows up, since axis and
 * button indices are only meaningful under the standard mapping.
 */
export function createGamepadReader({ onMappingWarning = null } = {}) {
  let prevButtons = [];
  let mappingWarned = false;

  function poll() {
    const gp = activeGamepad();
    if (!gp) {
      prevButtons = [];
      return {
        connected: false,
        stick: ZERO_STICK,
        rstick: ZERO_STICK,
        edge: () => false,
        pressed: () => false,
        value: () => 0,
      };
    }

    const isStandard = gp.mapping === 'standard';
    if (!isStandard && !mappingWarned) {
      mappingWarned = true;
      if (onMappingWarning) onMappingWarning();
    }

    const stick = applyStickCurve(gp.axes[0] || 0, gp.axes[1] || 0);
    // Only trust axes 2/3 on a standard pad — others report different indices.
    const rstick = (isStandard && gp.axes.length >= 4)
      ? applyStickCurve(gp.axes[2] || 0, gp.axes[3] || 0, 0.18)
      : ZERO_STICK;

    // Bind the previous snapshot by value — `prevButtons` is reassigned below,
    // and a closure over the variable would compare this frame against itself.
    const before = prevButtons;
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const value = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
    const edge = (i) => pressed(i) && !before[i];

    prevButtons = gp.buttons.map((b) => b.pressed);
    return { connected: true, pad: gp, stick, rstick, edge, pressed, value };
  }

  return { poll };
}
