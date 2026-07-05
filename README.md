# Gyro Spotlight Tracker

A lightweight, pure-web projection-mapping system: a performer walks left and right
across a ~3.5 m stage while a canvas spotlight on the projected screen tracks their
position. The phone stays **in a pocket**; orientation streams over Socket.IO on
local Wi-Fi — no internet required at show time.

## Stack

- **Server**: Node.js + Express + Socket.IO (relay + shared state)
- **Desktop renderer**: vanilla JS + HTML5 2D Canvas, full screen
- **Mobile transmitter**: vanilla JS + Tailwind CSS (vendored locally in
  `public/vendor/tailwind.js`, so everything works offline)
- **Pairing**: QR code generated at boot from the machine's LAN IP

## Two-screen setup

```
Projector / TV  →  https://<lan-ip>:3000/        (QR, preview, spotlight)
Laptop operator →  https://<lan-ip>:3000/operator  (calibration wizard)
iPhone          →  https://<lan-ip>:3000/mobile    (sensors only, then pocket)
```

The **projector** never shows calibration buttons — only the QR code, a dim
preview dot during calibration, and the live spotlight.

The **laptop** runs the operator page: confirm positions, verification walk, Start Show.

## Standard projector layout

```
        [ Screen — UPSTAGE / back wall ]
              ↑ projected image
              
   L -------- C -------- R   ← performer walks this line (downstage)
              
        [ Audience — DOWNSTAGE ]
              
   [ Projector + laptop — at back ]
```

## How pocket tracking works

The phone reads orientation (compass + tilt). That only changes with position if
your **body faces the audience center** — the normal performance stance.

The app samples **alpha, beta, and gamma** in the pocket at **two stage marks**
(left and right edges), auto-picks the best axis, and uses **gyro+compass fusion**
during the show to smooth pocket jitter.

## Quick start

```bash
npm install
npm start
```

Console output:

```
Desktop (projector): https://192.168.x.x:3000/
Operator (laptop):   https://192.168.x.x:3000/operator
Mobile  (performer): https://192.168.x.x:3000/mobile
```

### 1. Phone (once)

- Scan QR on projector → **Activate Motion Sensors** → pocket the phone.
- Artist does not touch the phone again.

### 2. Laptop — operator page (`/operator`)

Two-step calibration with **averaged pocket samples** on each Confirm:

| Step | Artist stands at | Operator action |
| --- | --- | --- |
| 1 | Left edge (projector shows target line) | Confirm (or Space) |
| 2 | Right edge (projector shows target line) | Confirm |

At each mark: face audience center, hold still ~1 s while the server averages readings.

**Verification walk:** artist slowly walks left → right. Operator watches the
**projector** spotlight, then clicks **Start Show**.

### 3. Show

Walk the stage — spotlight follows. Same pocket, face audience center.

## Projector during calibration

While the operator calibrates on the laptop, the projector shows:

- **Bright target line + label** at the current mark (where the artist should stand)
- **Dim preview dot** at the mapped position from confirmed marks so far

During verification and live show, the full spotlight appears.

## Maximizing pocket accuracy

| Do | Why |
| --- | --- |
| **Same pocket every time** | Consistent orientation signature |
| **Face audience center** at each mark | Creates heading spread across stage width |
| **Hold still before Confirm** | Server averages ~0.8 s of pocket readings |
| **Verification walk** before Start Show | Catch bad calibration before the audience |
| **Operator on `/operator`, not projector** | Artist never sees calibration UI |

| Avoid | Why |
| --- | --- |
| Facing only upstage (screen) | Heading stays constant — tracking fails |
| Switching pockets mid-show | Breaks mapping |
| Confirming before artist is still | Noisy averaged snapshot |

## Tracking modes

### Stage Walk (primary)

Pocket-based horizontal tracking with 2-point edge calibration, verification
step, multi-axis mapping, and gyro+compass fusion.

### Pointer (experimental)

Hand-held laser-pointer aim. Calibrated on the phone.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTPS port |

Settings in `server.js` → `state.settings`:

| Key | Default | Meaning |
| --- | --- | --- |
| `stageSmoothingFactor` | `0.1` | Lerp per frame for stage walk |
| `gyroCorrectionGain` | `0.03` | Compass pull on gyro fusion (lower = smoother, more lag) |

### Why HTTPS?

iOS requires a secure context for motion sensors and Wake Lock. Self-signed cert at
boot; one-time trust on each device. Fully offline at show time.
