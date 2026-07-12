# Gamepad Spotlight

A fully static projection spotlight driven by a **gamepad** — one HTML file, no server, no pairing, no calibration. Plug in a controller and go.

## Stack

- **Projector**: a single self-contained page (`public/index.html`) — vanilla JS + HTML5 2D Canvas
- **Input**: browser [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API), polled every animation frame

## Quick start

Open `public/index.html` directly in Chrome (double-click / `file://` works), or serve it:

```bash
npm start   # npx serve public
```

Connect a controller and **press any button** — browsers only expose a gamepad after the first input.

## Controls (Xbox layout, standard mapping)

| Control | Action | Effect |
| --- | --- | --- |
| **Left stick** | Deflect | Moves the spotlight (velocity — it holds position when released) |
| **A** | Tap | Burst — shockwave + sparks at the spotlight |
| **X** | Hold | Expand — spotlight grows ~2.5×, springs back on release |
| **B** | Tap | Aura — toggle breathing halo + orbiting embers |
| **Y** | Tap | Recenter — snap spotlight back to screen center |

## Feel & tuning

Movement is a **velocity model**: stick deflection sets speed and direction, so you can park the spot on a performer and let go. A radial dead zone rejects stick drift, and an expo curve gives fine control near center with fast sweeps at full deflection.

Tunables at the top of the script in `public/index.html`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `MOVE_SPEED` | `1.1` | Full-deflection travel, in screen-widths per second |
| `STICK_DEADZONE` | `0.12` | Radial dead zone (raise if the spot drifts on its own) |
| `STICK_EXPO` | `1.6` | Response curve; >1 = finer control near center |
| `INVERT_Y` | `false` | Flip if up/down feels backwards on your controller |
| `FOLLOW_RATE` | `28` | Spotlight easing (higher = snappier) |
| `BTN_*` | `0/1/2/3` | Button indices — remap effects here |

## Tests

```bash
npm install
npm test
```

Playwright loads the page over `file://` with a mock gamepad injected, then drives the stick and buttons to verify movement, hold, dead zone, clamping, and every effect.
