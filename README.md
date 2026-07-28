# Gamepad Spotlight

A fully static projection light show driven by a **gamepad** — one HTML file, no server, no pairing, no calibration. Plug in a controller and go. Every button does something; plug in a mic or audio interface and the whole scene breathes with the music.

## Stack

- **Projector**: a single self-contained page (`public/index.html`) — vanilla JS, Three.js WebGPU/TSL, animejs for feel
- **Particles**: instanced sprites (one draw call per effect) with per-instance position/color/size read by TSL nodes — WebGPU can only draw 1px point primitives, so fat particles must be instanced quads. Charge uses continuous ribbon meshes (triangle strips) instead of sprites so the RT hold reads as luminous filaments. Falls back to WebGL2 automatically; `?webgl=1` forces it
- **Input**: browser [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API), polled every animation frame. Non-standard pads get an on-screen warning — button indices assume the `standard` mapping
- **Audio**: [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) analyser over `getUserMedia` — any input device (built-in mic, USB audio interface) works

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
| **Right stick** | Deflect | Aims the stand around the spot; leans embers/wisps into the wind |
| **A** | Tap | Burst — shockwave + sparks (plus a stand barrage while the stand is out) |
| **B** | Tap | Power aura — warm figure with breathing halo + rising embers |
| **X** | Hold | Expand — spotlight grows ~2.5×, springs back on release |
| **Y** | Tap | Recenter — snap spotlight back to screen center |
| **LB** | Tap | Ghost aura — cold spectral wisps + lagging afterimages of the spot |
| **RB** | Tap | Stand — a violet second figure materializes beside the spot |
| **LT** | Hold (analog) | Slow motion — dilates effect time, control stays real-time |
| **RT** | Hold (analog) | Charge — luminous ribbons stream in from beyond the screen edges and converge on the spot; **release** detonates a nova scaled by charge |
| **Select** | Tap | Audio-reactive mode — asks for mic/interface, scene pulses to the signal |
| **Start** | Tap | HUD overlay — controls + live status (palette, bands, charge, time) |
| **L3** | Tap | Blackout — instant fade to black (panic button for live use) |
| **R3** | Tap | Strobe — beat-synced when audio is on, gentle 2 Hz pulse otherwise |
| **D-pad ↑ / ↓** | Tap | Base spot size up / down |
| **D-pad ← / →** | Tap | Cycle palette: SOLAR · SPECTRE · VENOM · CRIMSON · MONO |

## Audio-reactive mode

Press **Select** and grant microphone access — a USB audio interface shows up as a mic input, so you can feed it a board mix. The analyser splits the signal into bass / mid / treble:

- **Bass** swells the spotlight radius and the aura figure
- **Mids** fatten the particle grain
- **Treble** drives the shimmer displacement on the aura, ghost, and stand
- **Beats** (bass flux) fire a soft ripple ring from the spot — and the strobe, if it's armed

Press Select again to release the device.

**No interface?** Play the music out loud and let the built-in mic hear it — fine for driving bass/mid/treble envelopes. For a clean signal without hardware, install a virtual loopback device (BlackHole on macOS, VB-Audio Cable or Stereo Mix on Windows; PulseAudio/PipeWire already publishes a "Monitor of …" source on Linux) and select it as the system default input.

## `/peaceful` — the second show

A separate page at `public/peaceful/index.html`, served at `/peaceful`. Warm light panels receding into black, human silhouettes backlit in front of them, and hard cuts on the beat.

Where the projector is orthographic and screen-flat, this one is a **perspective** scene in world units — the left stick orbits the camera, so the panels parallax against each other and the frame has real depth. Panels are TSL box-gradient quads with per-panel uniforms; figures are the baked `body-cloud.js` point cloud rendered as instanced quads that blend *multiplicatively* (`dst *= 1−α`), making them pure light-blockers rather than dark sprites. Each figure stands just in front of its own panel — staging them all at one depth breaks alignment under perspective and they vanish. On WebGPU a post stack adds bloom, chromatic aberration, vignette, film grain and scanlines.

A cut reseeds the whole composition — panel count and layout, 1–3 figures, brightness, colour — fired by beat detection (rate-limited so it lands on accents, not every kick) with an idle fallback so the scene keeps moving with audio off. Between cuts it barely moves, which is what makes the snap read as a cut.

| Control | Action |
| --- | --- |
| **L-stick** | Orbit camera (the main depth cue) |
| **R-stick** | Dolly · panel depth spread |
| **A** / **RT** | Cut now / hold to charge, release cuts |
| **B** | Figures on/off |
| **D-pad ↑↓ / ←→** | Panel count / palette |
| **LT** · **L3** · **Select** · **Start** | Slow-mo · blackout · audio · HUD |

Shared helpers live in `public/lib/` (`math`, `palette`, `audio`, `gamepad`) as DOM-free ES modules. `public/index.html` still carries its own inline copies and is untouched.

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
| `CHARGE_RATE` | `0.9` | Charge per second at full RT pull |
| `SLOWMO_DEPTH` | `0.78` | Full LT pull slows effect time to 1 − this |
| `RADIUS_BASE_*` | — | Spot size default / step / clamps for the D-pad |
| `BTN_*` | `0–15` | Button indices — remap everything here |

## Tests

```bash
npm install
npm test
```

Playwright loads the page over `file://` with a mock gamepad injected, then drives both sticks, the triggers, and every button to verify movement, dead zone, clamping, charge/nova, slow-mo, palettes, blackout, strobe, HUD, audio toggle, and each effect. A pixel-probe spec additionally reads the rendered canvas back and asserts real light hits the screen (and that blackout kills it) — state tests alone once let an invisible-particle regression through. Tests force the WebGL2 backend at reduced resolution; headless software WebGPU is flaky.

`/peaceful` has its own specs covering cuts, panel count, palette, orbit easing and charge, plus a probe asserting the silhouettes actually remove light. Its probe takes `{ noHalos: true }` to hide the additive head glows — they add back more light than the bodies remove and would flip the comparison — and `window.__setIdleCuts(false)` freezes the composition so two frames stay comparable.

If Playwright can't find a browser, point it at one: `PW_CHROMIUM_PATH=/path/to/chrome npm test`.
