/**
 * Drum Tempo LED — mic amplitude onset → BPM vs target → 9-bar zone LED
 *
 * Bars L→R: red, red, yellow, yellow, GREEN (tall), yellow, yellow, red, red
 * Slow → left · ON → center green · Fast → right
 *
 * Requires HTTPS or localhost for getUserMedia (Mobile Safari).
 */

(function () {
  "use strict";

  const BAR_DEFS = [
    { color: "red", zone: -4 },
    { color: "red", zone: -3 },
    { color: "yellow", zone: -2 },
    { color: "yellow", zone: -1 },
    { color: "green", zone: 0 },
    { color: "yellow", zone: 1 },
    { color: "yellow", zone: 2 },
    { color: "red", zone: 3 },
    { color: "red", zone: 4 },
  ];

  // |% error| thresholds → zone magnitude 0..4
  const THRESHOLDS = [
    { maxPct: 4.2, zone: 0 },    // green ≈ 115–125 at 120
    { maxPct: 13, zone: 1 },
    { maxPct: 18, zone: 2 },
    { maxPct: 22, zone: 3 },
    { maxPct: Infinity, zone: 4 },
  ];

  const IDLE_MS = 2200;
  const MIN_INTERVAL_MS = 120; // debounce / refractory (~500 BPM ceiling)
  const MAX_INTERVAL_MS = 2200;
  const SMOOTH_N = 6;
  const FFT_SIZE = 2048;

  const ledRow = document.getElementById("ledRow");
  const bpmInput = document.getElementById("bpmInput");
  const bpmSlider = document.getElementById("bpmSlider");
  const bpmDown = document.getElementById("bpmDown");
  const bpmUp = document.getElementById("bpmUp");
  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const statusHint = document.getElementById("statusHint");
  const playingBpmEl = document.getElementById("playingBpm");
  const errorReadout = document.getElementById("errorReadout");
  const resetBtn = document.getElementById("resetBtn");
  const levelFill = document.getElementById("levelFill");
  const sensSlider = document.getElementById("sensSlider");

  let targetBpm = 120;
  let hitTimes = [];
  let litIndex = "";
  let idleTimer = null;
  let listening = false;

  // Audio
  let audioCtx = null;
  let mediaStream = null;
  let analyser = null;
  let timeData = null;
  let rafId = null;
  let lastHitAt = 0;
  let noiseFloor = 0.02;
  let emaLevel = 0;
  let prevLevel = 0;

  const leds = BAR_DEFS.map((def) => {
    const el = document.createElement("div");
    el.className = `led ${def.color}`;
    el.dataset.zone = String(def.zone);
    el.setAttribute("role", "presentation");
    ledRow.appendChild(el);
    return el;
  });

  function clampBpm(n) {
    n = Math.round(Number(n) || 120);
    return Math.min(240, Math.max(40, n));
  }

  function setTarget(n, syncSlider) {
    targetBpm = clampBpm(n);
    bpmInput.value = String(targetBpm);
    if (syncSlider !== false) bpmSlider.value = String(targetBpm);
    if (hitTimes.length >= 2) updateFromHits(false);
  }

  function clearLeds() {
    leds.forEach((el) => el.classList.remove("lit"));
    litIndex = "";
  }

  // magnitude 0 = center green; 1..4 walk outward on BOTH sides
  const PAIR = {
    0: [4],
    1: [3, 5],
    2: [2, 6],
    3: [1, 7],
    4: [0, 8],
  };

  function lightZone(mag) {
    const key = String(mag);
    if (key === litIndex) return;
    clearLeds();
    (PAIR[mag] || PAIR[4]).forEach((i) => leds[i].classList.add("lit"));
    litIndex = key;
  }

  function pctToZone(pctError) {
    const abs = Math.abs(pctError);
    for (const t of THRESHOLDS) {
      if (abs <= t.maxPct) return t.zone;
    }
    return 4;
  }

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      clearLeds();
      playingBpmEl.textContent = "—";
      errorReadout.textContent = "—";
      hitTimes = [];
    }, IDLE_MS);
  }

  function updateFromHits(schedule) {
    if (hitTimes.length < 2) return;

    const intervals = [];
    for (let i = 1; i < hitTimes.length; i++) {
      intervals.push(hitTimes[i] - hitTimes[i - 1]);
    }
    const targetMs = 60000 / targetBpm;
    // ignore ghost notes / doubles much faster than the target pulse
    const filtered = intervals.filter((ms) => ms >= targetMs * 0.55);
    const pool = (filtered.length ? filtered : intervals).slice(-SMOOTH_N);
    const sorted = pool.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const avgMs = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    const playing = 60000 / avgMs;
    const pctError = ((playing - targetBpm) / targetBpm) * 100;
    const zone = pctToZone(pctError);

    playingBpmEl.textContent = String(Math.round(playing));
    const sign = pctError > 0 ? "+" : "";
    errorReadout.textContent = `${sign}${pctError.toFixed(1)}%`;
    lightZone(zone);

    if (schedule !== false) scheduleIdle();
  }

  function registerHit(now) {
    if (now - lastHitAt < MIN_INTERVAL_MS) return;
    lastHitAt = now;

    if (hitTimes.length) {
      const gap = now - hitTimes[hitTimes.length - 1];
      if (gap > MAX_INTERVAL_MS) {
        hitTimes = [now];
        clearLeds();
        playingBpmEl.textContent = "—";
        errorReadout.textContent = "—";
        scheduleIdle();
        return;
      }
    }

    hitTimes.push(now);
    if (hitTimes.length > SMOOTH_N + 1) {
      hitTimes = hitTimes.slice(-(SMOOTH_N + 1));
    }

    document.body.classList.add("hit-flash");
    setTimeout(() => document.body.classList.remove("hit-flash"), 120);

    updateFromHits(true);
  }

  /** Sensitivity 1–100 → relative onset multiplier over noise floor */
  function thresholdFromSensitivity() {
    const s = Number(sensSlider.value) || 45;
    // Higher sensitivity = lower multiplier (easier to trigger)
    // s=1 → ~4.5× floor, s=45 → ~2.2×, s=100 → ~1.25×
    return 4.6 - (s / 100) * 3.35;
  }

  function rmsFromTimeDomain(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function analyseFrame(now) {
    if (!analyser || !listening) return;

    analyser.getByteTimeDomainData(timeData);
    const level = rmsFromTimeDomain(timeData);

    // Slow-adapt noise floor (ignore peaks)
    const alphaFloor = level < noiseFloor * 1.8 ? 0.05 : 0.002;
    noiseFloor = noiseFloor * (1 - alphaFloor) + level * alphaFloor;
    noiseFloor = Math.max(0.008, Math.min(noiseFloor, 0.15));

    emaLevel = emaLevel * 0.7 + level * 0.3;

    // Level meter UI
    const meterPct = Math.min(100, (level / 0.35) * 100);
    levelFill.style.width = meterPct.toFixed(1) + "%";

    const mult = thresholdFromSensitivity();
    const thresh = Math.max(noiseFloor * mult, 0.03);
    const rising = level > prevLevel * 1.15 || level - prevLevel > 0.02;
    const above = level > thresh && level > emaLevel * 1.25;

    if (above && rising) {
      registerHit(now);
    }

    prevLevel = level;
  }

  function loop() {
    if (!listening) return;
    analyseFrame(performance.now());
    rafId = requestAnimationFrame(loop);
  }

  async function startMic() {
    statusHint.textContent = "Requesting microphone…";
    micBtn.classList.remove("error");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia not supported in this browser");
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Safari often ignores these; still request raw-ish input
        },
        video: false,
      });

      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      timeData = new Uint8Array(analyser.fftSize);

      listening = true;
      noiseFloor = 0.02;
      emaLevel = 0;
      prevLevel = 0;
      lastHitAt = 0;

      micBtn.classList.add("listening");
      micBtn.setAttribute("aria-pressed", "true");
      micLabel.textContent = "Listening — tap to stop";
      statusHint.textContent =
        "Play drums toward the phone. Adjust sensitivity if hits are missed or double-triggered.";

      rafId = requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      listening = false;
      micBtn.classList.add("error");
      micBtn.setAttribute("aria-pressed", "false");
      micLabel.textContent = "Mic blocked — try again";
      statusHint.textContent =
        "Microphone permission denied or unavailable. On iPhone: Settings → Safari → Microphone, or allow when prompted. Use HTTPS.";
      stopMic(false);
    }
  }

  function stopMic(updateUi) {
    listening = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    analyser = null;
    timeData = null;
    levelFill.style.width = "0%";

    if (updateUi !== false) {
      micBtn.classList.remove("listening", "error");
      micBtn.setAttribute("aria-pressed", "false");
      micLabel.textContent = "Enable Microphone";
      statusHint.textContent = "Mic off. Tap the button to listen again.";
    }
  }

  function toggleMic() {
    if (listening) stopMic(true);
    else startMic();
  }

  function resetAll() {
    hitTimes = [];
    clearLeds();
    playingBpmEl.textContent = "—";
    errorReadout.textContent = "—";
    if (idleTimer) clearTimeout(idleTimer);
  }

  bpmInput.addEventListener("change", () => setTarget(bpmInput.value));
  bpmInput.addEventListener("blur", () => setTarget(bpmInput.value));
  bpmSlider.addEventListener("input", () => setTarget(bpmSlider.value, false));
  bpmDown.addEventListener("click", () => setTarget(targetBpm - 1));
  bpmUp.addEventListener("click", () => setTarget(targetBpm + 1));
  micBtn.addEventListener("click", toggleMic);
  resetBtn.addEventListener("click", resetAll);

  document.addEventListener(
    "gesturestart",
    (e) => e.preventDefault(),
    { passive: false }
  );

  // Resume audio if iOS suspends after backgrounding
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && audioCtx && audioCtx.state === "suspended" && listening) {
      audioCtx.resume().catch(() => {});
    }
  });

  setTarget(120);

  const params = new URLSearchParams(location.search);
  const full = params.get("full") === "ace";
  const TRIAL_MS = 2 * 60 * 1000;
  if (!full) {
    setTimeout(() => {
      const wall = document.createElement("div");
      wall.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.82);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;";
      wall.innerHTML = '<h2 style="margin:0 0 8px">Trial over</h2><p>2 free minutes. Full Drum Ace is $9.</p><a href="sell.html" style="color:#041;background:#22c55e;font-weight:800;text-decoration:none;padding:12px 18px;border-radius:6px">Pay w paypal</a>';
      document.body.appendChild(wall);
      if (listening && micBtn) micBtn.click();
    }, TRIAL_MS);
  }

  clearLeds();
})();
