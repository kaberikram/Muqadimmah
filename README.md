# Gyro Spotlight Tracker

A lightweight, pure-web projection spotlight controlled like a **laser pointer** — point the phone at the screen and the spotlight follows.

## Stack

- **Server**: Node.js + Express + Socket.IO (relay + shared state)
- **Projector**: vanilla JS + HTML5 2D Canvas, full screen
- **Phone**: vanilla JS + Tailwind CSS (laser pointer controller)
- **Pairing**: QR code generated at boot from the machine's LAN IP

## Setup

```
Projector + laptop  →  https://<lan-ip>:3000/
Phone remote        →  https://<lan-ip>:3000/mobile
```

## How it works

- Hold phone like a **laser pointer** (top edge toward screen)
- **Pan left/right** and **tilt up/down** use decoupled 3D aim (beta/gamma no longer mapped independently)
- **Calibrate Center**: point at screen center, tap once — that aim becomes center
- **Re-calibrate Center**: point at center again if drift appears
- **Snappy follow** — frame-rate-independent smoothing bridges sensor packets without lag
- One Euro filter removes hand tremor when holding still; eases off during fast sweeps

## Quick start

```bash
npm install
npm start
```

### 1. Projector

Open `https://<lan-ip>:3000/` — QR code until phone pairs.

### 2. Phone

1. Scan QR → **Activate Motion Sensors**
2. Point at **screen center** → **Calibrate Center**
3. Aim to move the spotlight
4. Adjust horizontal/vertical **reach** sliders if needed (higher = faster sweep)

### 3. Effects (after calibration)

| Button | Action | Effect |
| --- | --- | --- |
| **Burst** | Tap | Explosive shockwave + sparks at aim point |
| **Expand** | Hold | Spotlight grows ~2.5× while held, springs back on release |
| **Aura** | Toggle | Breathing magical halo + orbiting embers around the spot |

Point at your target, then trigger — effects render wherever the spotlight is aimed.

## Tips

| Do | Why |
| --- | --- |
| Calibrate while pointing at center | Establishes zero reference |
| Hold phone portrait, top toward screen | Matches gamma/beta → x/y mapping |
| Re-calibrate if spot drifts | Fixes grip shift without restarting |

| Avoid | Why |
| --- | --- |
| Holding phone flat like a table | Axes won't match screen aim |
| Skipping calibration | Spotlight won't know where "center" is |

## Configuration

Settings in `server.js` → `state.settings` (also adjustable from phone sliders):

| Key | Default | Meaning |
| --- | --- | --- |
| `pointerSensitivityX` | `58` | Pixels per degree of pan (gamma) — reach |
| `pointerSensitivityY` | `52` | Pixels per degree of tilt (beta) — reach |
| `invertX` / `invertY` | `true` | Flip axis direction |
| `pointerFollowRate` | `28` | Display follow speed (higher = snappier) |
| `useOneEuro` | `true` | Adaptive jitter filter when holding still |

## Tests

```bash
npm test
```

## Why HTTPS?

iOS requires a secure context for motion sensors. Self-signed cert at boot; one-time trust on each device.
