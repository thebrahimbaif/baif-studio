(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ─────────────────────────────────────────────
     Hero: head tracking + stipple cursor trail (ported from the mockup)
     ───────────────────────────────────────────── */
  var hero = document.querySelector('.hero');
  var figure = hero.querySelector('.figure');
  var heads = {};
  figure.querySelectorAll('[data-pose]').forEach(function (img) { heads[img.getAttribute('data-pose')] = img; });
  var pose = 'down', watching = false, touchTimer = 0;
  var tiltPose = null; // set by phone tilt (see below); where he looks when nothing else holds his attention
  var REACH = 0.6; // attention radius as a share of the figure's height

  function setPose(p) {
    if (p === pose) return;
    heads[pose].classList.remove('on');
    heads[p].classList.add('on');
    pose = p;
  }
  function rest() { watching = false; clearTimeout(touchTimer); setPose(tiltPose || 'down'); }

  function track(e) {
    // Art is 396 × 684, drawn with object-fit: contain; head centre sits at (195, 262).
    var r = figure.getBoundingClientRect();
    var scale = Math.min(r.width / 396, r.height / 684);
    var headX = r.left + (r.width - 396 * scale) / 2 + 195 * scale;
    var headY = r.top + (r.height - 684 * scale) / 2 + 262 * scale;
    var dx = e.clientX - headX, dy = e.clientY - headY;
    var distance = Math.hypot(dx, dy);
    var reach = REACH * 684 * scale;
    if (distance > reach * (watching ? 1.12 : 1)) { rest(); return; }
    watching = true;

    clearTimeout(touchTimer);
    if (e.pointerType && e.pointerType !== 'mouse') touchTimer = setTimeout(rest, 2500);
    if (distance < 26 * scale) return; // cursor on his face: hold

    var centres = { right: 0, down: 90, left: 180, up: -90 };
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    var best = pose, bestGap = Infinity;
    for (var name in centres) {
      var gap = Math.abs(angle - centres[name]) % 360;
      if (gap > 180) gap = 360 - gap;
      if (gap < bestGap) { bestGap = gap; best = name; }
    }
    if (best !== pose && bestGap > 38) return; // hysteresis
    setPose(best);
  }

  var canvas = hero.querySelector('.trail');
  var ctx = canvas.getContext && canvas.getContext('2d');
  var marks = [], lastPoint = null, frame = 0;
  var HOLD = 400, FADE = 400;

  function trail(e) {
    if (calm || !ctx) return;
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    var box = hero.getBoundingClientRect();
    var x = e.clientX - box.left, y = e.clientY - box.top, now = performance.now();
    var last = lastPoint;
    if (!last || now - last.t > 120) { lastPoint = { x: x, y: y, t: now }; return; }
    var dx = x - last.x, dy = y - last.y, dist = Math.hypot(dx, dy);
    if (dist < 2) { last.t = now; return; }
    lastPoint = { x: x, y: y, t: now };
    var nx = -dy / dist, ny = dx / dist;
    var steps = Math.max(1, Math.round(dist / 3.5));
    for (var i = 0; i < steps; i++) {
      var f = (i + Math.random()) / steps;
      var off = (Math.random() + Math.random() - 1) * 14;
      marks.push({ x: last.x + dx * f + nx * off, y: last.y + dy * f + ny * off, r: 0.5 + Math.random() * 0.65, a: 0.4 + Math.random() * 0.4, t: now });
    }
    if (marks.length > 6000) marks.splice(0, marks.length - 6000);
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function paint() {
    frame = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1753C1';
    var now = performance.now(), alive = [];
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], age = now - m.t;
      if (age >= HOLD + FADE) continue;
      var k = age <= HOLD ? 1 : 1 - (age - HOLD) / FADE;
      ctx.globalAlpha = m.a * k * k * (3 - 2 * k);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      alive.push(m);
    }
    ctx.globalAlpha = 1;
    marks = alive;
    if (alive.length) frame = requestAnimationFrame(paint);
  }

  hero.addEventListener('pointermove', function (e) { trail(e); track(e); });
  hero.addEventListener('pointerdown', track);
  hero.addEventListener('pointerleave', function () { lastPoint = null; rest(); });

  /* ─────────────────────────────────────────────
     Phones: tilt the phone and he looks that way; the scene shifts slightly for depth.
     Uses deviceorientation (needs HTTPS). iOS only grants it after a tap, so the first
     tap on the page (anywhere but the Contact button) asks for permission.
     The resting angle is learned from the first readings and slowly re-centres, so
     however the phone is held, holding it still means he goes back to his laptop.
     ───────────────────────────────────────────── */
  var touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (touchOnly && !calm && 'DeviceOrientationEvent' in window) {
    var base = null, latest = null, tiltFrame = 0, sx = 0, sy = 0;
    var ON = 10, OFF = 6, SHIFT = 12; // degrees to turn his head, degrees to let go, max px of drift

    function applyTilt() {
      tiltFrame = 0;
      if (!latest) return;
      var g = latest.g, b = latest.b;
      if (!base) base = { g: g, b: b };
      // drift the resting angle toward how the phone is being held now
      base.g += (g - base.g) * 0.004;
      base.b += (b - base.b) * 0.004;
      var dx = Math.max(-30, Math.min(30, g - base.g));   // + tilts right
      var dy = Math.max(-30, Math.min(30, b - base.b));   // + top of phone toward the viewer (more upright)

      // head: hysteresis so it does not flicker around the thresholds
      var held = tiltPose && tiltPose !== 'down';
      var lim = held ? OFF : ON, next = 'down';
      if (Math.abs(dx) > lim || dy > lim) {
        next = Math.abs(dx) >= dy ? (dx < 0 ? 'left' : 'right') : 'up';
      }
      tiltPose = next;
      if (!watching) setPose(next);

      // depth: figure leans with the tilt, sky drifts the other way (smoothed)
      sx += (dx / 30 * SHIFT - sx) * 0.2;
      sy += (dy / 30 * SHIFT - sy) * 0.2;
      hero.style.setProperty('--tilt-x', sx.toFixed(2) + 'px');
      hero.style.setProperty('--tilt-y', sy.toFixed(2) + 'px');
      if (Math.abs(sx - dx / 30 * SHIFT) > 0.1 || Math.abs(sy - dy / 30 * SHIFT) > 0.1) {
        tiltFrame = requestAnimationFrame(applyTilt);
      }
    }
    function onOrient(e) {
      if (e.gamma == null || e.beta == null) return;
      latest = { g: e.gamma, b: e.beta };
      if (!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
    }
    function listen() { window.addEventListener('deviceorientation', onOrient); }

    var ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === 'function') {
      // iOS 13+: must be requested from a tap
      var askOnce = function (e) {
        if (e.target.closest && e.target.closest('.cta')) return;
        document.removeEventListener('click', askOnce);
        ask.call(window.DeviceOrientationEvent).then(function (state) {
          if (state === 'granted') listen();
        }).catch(function () {});
      };
      document.addEventListener('click', askOnce);
    } else {
      listen();
    }
  }

  /* ───────── Contact button: grows to reveal the email on hover / keyboard focus ─────────
     The two label widths are measured so the pill can animate between them
     (they change with the hero's scale, so re-measure on resize). */
  var cta = document.querySelector('.cta');
  var ctaLabel = cta.querySelector('.cta-label');
  var ctaEmail = cta.querySelector('.cta-email');
  function sizeCta() {
    var pad = parseFloat(getComputedStyle(cta).paddingLeft) * 2;
    cta.style.setProperty('--w-label', Math.ceil(ctaLabel.scrollWidth + pad) + 'px');
    cta.style.setProperty('--w-email', Math.ceil(ctaEmail.scrollWidth + pad) + 'px');
    cta.classList.add('sized');
  }
  sizeCta();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeCta);
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(sizeCta, 120); });
})();
