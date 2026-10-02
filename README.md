# Drum Ace

iPhone-friendly web app: a horizontal **9-bar LED tempo meter** driven by your **microphone** hearing drum hits.

```
[ red ][ red ][ yellow ][ yellow ][ GREEN ][ yellow ][ yellow ][ red ][ red ]
  far     near    mid      near     ON        near      mid      near   far
  slow    slow    slow     slow    tempo      fast      fast     fast   fast
```

Center green is taller/thicker. Bars look like highlighter markers when lit, dim when off, on a light paper-like stage.

## Behavior

1. Set **target BPM** (40–240) with − / +, number field, or slider.
2. Tap **Enable Microphone** and allow access.
3. Play drums toward the phone. Onset detection (amplitude spike over a slow noise floor) registers hits.
4. Hit-to-hit interval → estimated playing BPM → **% error** vs target.
5. The matching zone LED lights (needle style — one zone at a time):
   - Far / near slow → outer / inner **left reds & yellows**
   - On tempo (~±1.5%) → **center GREEN**
   - Near / far fast → **right yellows & reds**
6. **Sensitivity** slider: higher = easier hit triggers (lower threshold over noise floor).
7. Idle ~2.2s without hits clears the LEDs. **Reset** clears timing state.

## Files

| Path | Role |
|------|------|
| `index.html` | App shell, BPM UI, LED stage, mic controls |
| `styles.css` | Dark chrome + paper LED stage, Mobile Safari / safe-area |
| `app.js` | `getUserMedia` + AnalyserNode onset → BPM → LED zones |
| `README.md` | This file |

## Run (Mobile Safari)

Mic access needs a **secure context**: **HTTPS** or `localhost`.

```bash
cd /workspace/drum-tempo
# example: python3 -m http.server 8080
# open https://… or http://localhost:8080 on the phone
```

Add to Home Screen for a fuller app feel (`apple-mobile-web-app-capable`).

### iPhone tips

- Allow microphone when prompted (Safari or Settings → Safari → Microphone).
- Hold the phone near the kit; reduce Sensitivity if double-triggers, raise if hits are missed.
- Echo cancellation / noise suppression are requested off for cleaner drum transients (Safari may still process audio).

## Note

This is **hit-rate tempo** (inter-onset interval), not a full music-information-retrieval beat tracker. Best with clear, consistent drum hits (e.g. snare or kick on the beat).
