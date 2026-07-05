# Gyro Spotlight Tracker

A lightweight, pure-web projection-mapping system: a performer carries an iPhone
in their pocket, and a desktop browser (driving a projector) renders a canvas
spotlight that follows their left/right position across the stage. Orientation
data streams from the phone's compass over Socket.IO on the local Wi-Fi —
no internet required at show time.

## Stack

- **Server**: Node.js + Express + Socket.IO (relay + shared state)
- **Desktop renderer**: vanilla JS + HTML5 2D Canvas, full screen
- **Mobile transmitter**: vanilla JS + Tailwind CSS (vendored locally in
  `public/vendor/tailwind.js`, so everything works offline)
- **Pairing**: QR code generated at boot from the machine's LAN IP

## Quick start

```bash
npm install
npm start
```

The console prints two URLs:

```
Desktop (projector): https://192.168.x.x:3000/
Mobile  (performer): https://192.168.x.x:3000/mobile
```

1. Open the **desktop** URL in the browser connected to the projector and make
   it full screen. Accept the self-signed certificate warning.
2. On the iPhone, **scan the QR code** shown on the desktop screen (or type the
   mobile URL). Accept the certificate warning there too.
3. Tap **Activate Motion Sensors** and grant the motion permission. The screen
   stays awake automatically (Wake Lock).
4. Calibrate: stand at the **left** edge of the stage facing the screen, tap
   **Set Left Boundary**; walk to the **right** edge, tap **Set Right
   Boundary**. The desktop switches to the live spotlight immediately.

### Why HTTPS with a self-signed certificate?

iOS Safari only exposes `DeviceOrientationEvent.requestPermission()` and the
Wake Lock API in a **secure context**. Over plain `http://` on a LAN IP the
motion-permission prompt never appears, so the server generates a self-signed
certificate at boot and serves everything over HTTPS. It's a one-time "trust
this website" tap on each device, and the whole loop still runs fully offline.

## Behavior details

- **Angle wraparound** — mapping uses signed shortest-arc math, so a stage that
  straddles the 359° → 0° compass seam works fine.
- **Inverse boundaries** — if the right boundary is a "smaller" angle than the
  left, the scale flips automatically; walking left always maps to x = 0.
- **Degenerate calibration** — boundaries closer than 5° apart are rejected
  with a message on the phone.
- **Disconnect handling** — if the phone drops mid-show, the spotlight holds
  its last position for 5 seconds, then fades out and shows a reconnect banner.
  Calibration survives the reconnect; the performer doesn't have to redo it.
- **Smoothing** — the desktop applies `currentX += (targetX - currentX) * 0.1`
  each animation frame to filter out pocket bounce.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTPS port for both pages and the socket |

The smoothing factor (`0.1`) lives in the server's shared state
(`settings.smoothingFactor` in `server.js`).
