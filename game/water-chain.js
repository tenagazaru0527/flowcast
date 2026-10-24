import { createState, step, DT, GEOMETRY as G, toWorld, cupPolygon, waterShape, massBalance } from './water-chain-model.js';

const $ = id => document.getElementById(id);
const canvas = $('scene'), ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let state = createState(), running = false, lastFrame = 0, accumulator = 0, lastReadout = -1;
let width = 0, height = 0, scale = 1, ox = 0, oy = 0;
const input = () => ({ flow: Number($('flow').value), sourceX: Number($('source').value) / 100, pouring: $('pouring').checked });
const px = x => ox + x * scale, py = y => oy + y * scale;
const f = (n, digits = 0) => n.toFixed(digits);

function path(points, close = false) {
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.y)) : ctx.moveTo(px(p.x), py(p.y)));
  if (close) ctx.closePath();
}
function line(points, color, size = 1) { path(points); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.stroke(); }
function segment(x1, y1, x2, y2, color, size = 1) { line([{ x: x1, y: y1 }, { x: x2, y: y2 }], color, size); }
function circle(x, y, r, fill, stroke = null) {
  ctx.beginPath(); ctx.arc(px(x), py(y), r * scale, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function text(label, x, y, color = '#aac2cf', size = 11, align = 'left') {
  ctx.fillStyle = color; ctx.font = `${size}px system-ui,sans-serif`; ctx.textAlign = align; ctx.fillText(label, px(x), py(y));
}
function water(polygon, level, volume, maxDepth, phase = 0) {
  if (volume < .01 || polygon.length < 3) return;
  ctx.save(); path(polygon, true); ctx.clip();
  const gradient = ctx.createLinearGradient(0, py(level), 0, py(level + maxDepth));
  gradient.addColorStop(0, '#b5f8ff72'); gradient.addColorStop(.07, '#54d7ef63');
  gradient.addColorStop(.7, '#108cb58c'); gradient.addColorStop(1, '#68dceca0');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  // Optical caustics only; do not perturb the simulated free-surface geometry.
  const t = reduced.matches ? 0 : state.time * .7;
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 12; i++) {
    const x = .2 + i * .069;
    const y = level + .025 + ((i * .027 + phase) % .10);
    ctx.beginPath(); ctx.ellipse(px(x), py(y), .038 * scale, .009 * scale, Math.sin(t + i) * .3, 0, Math.PI * 2);
    ctx.strokeStyle = '#c6ffff2b'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const surface = polygon.filter(p => Math.abs(p.y - level) < 1e-7);
  if (surface.length >= 2) {
    const left = Math.min(...surface.map(p => p.x)), right = Math.max(...surface.map(p => p.x));
    segment(left, level, right, level, '#e2ffffdd', 1.6);
    segment(left, level + .004, right, level + .004, '#b3ffff4a', 2);
    for (let i = 0; i < 3; i++) {
      const cx = left + (right - left) * (.25 + i * .25);
      ctx.beginPath(); ctx.ellipse(px(cx), py(level + .003), (right - left) * scale * (.10 + .02 * Math.sin(t * 2 + i)), .003 * scale, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#f1ffff75'; ctx.lineWidth = .7; ctx.stroke();
    }
  }
  ctx.restore();
}
function streams() {
  for (const kind of ['inlet', 'spill']) {
    const drops = state.particles.filter(p => p.kind === kind);
    if (!drops.length) continue;
    const draw = (color, factor) => {
      ctx.strokeStyle = color; ctx.lineCap = 'round';
      for (let i = 0; i < drops.length; i++) {
        const p = drops[i], next = drops[i + 1];
        const radius = Math.max(.001, Math.min(.009, Math.sqrt(p.volume / DT * 1e-6 / (Math.PI * Math.max(.2, Math.hypot(p.vx, p.vy))))));
        ctx.lineWidth = Math.max(.7, radius * scale * factor);
        path([p, next && Math.hypot(next.x - p.x, next.y - p.y) < .045 ? next : { x: p.x - p.vx * DT * .7, y: p.y - p.vy * DT * .7 }]); ctx.stroke();
      }
    };
    draw('#12789b44', 4.8); draw('#86e9ff85', 2.6); draw('#e2ffffc9', .6);
  }
  ctx.lineCap = 'butt';
}
function glass(points, thickness = 3) {
  const shadow = points.map(p => ({ x: p.x + .009, y: p.y + .011 }));
  ctx.lineJoin = 'round'; line(shadow, '#00000042', thickness * 3.5);
  line(points, '#062338bb', thickness + 4); line(points, '#98beca8c', thickness + 1);
  const shine = points.map(p => ({ x: p.x - .002, y: p.y - .001 }));
  line(shine, '#e8f9ffcf', Math.max(1, thickness * .4));
}
function drawCup() {
  const p = cupPolygon(state.angle), shape = waterShape(state.cup, state.angle);
  path(p, true); const tint = ctx.createLinearGradient(px(p[0].x), 0, px(p[1].x), 0);
  tint.addColorStop(0, '#c6f6ff22'); tint.addColorStop(.17, '#defaff07'); tint.addColorStop(.8, '#021a3322'); tint.addColorStop(1, '#deffff33');
  ctx.fillStyle = tint; ctx.fill();
  water(shape.polygon, shape.level, state.cup, .17);
  // Short interior jet is optical: incoming parcels mix on crossing the mouth.
  if (state.lastCupHit && state.time - state.lastCupHit.time < .04) {
    ctx.save(); path(p, true); ctx.clip();
    segment(state.lastCupHit.x, Math.min(p[0].y, p[1].y), state.lastCupHit.x, shape.level, '#bdfbff65', Math.max(1, state.inletRate / 60)); ctx.restore();
  }
  glass([p[0], p[3], p[2], p[1]], Math.max(2, scale * .004));
  line([p[0], p[1]], '#c4e6ec65', 1);
  // The left brass counterweight belongs to the dry vessel COM in the model.
  const counter = toWorld(-.165, .005, state.angle), joint = toWorld(0, .005, state.angle);
  line([counter, joint], '#8c9da8', 5); line([counter, joint], '#e0e8e8', 1);
  ctx.save(); ctx.translate(px(counter.x), py(counter.y)); ctx.rotate(state.angle);
  const brass = ctx.createLinearGradient(-12, -12, 12, 12); brass.addColorStop(0, '#f0d6a0'); brass.addColorStop(.5, '#b6975d'); brass.addColorStop(1, '#4f3d26');
  ctx.fillStyle = brass; ctx.fillRect(-.021 * scale, -.022 * scale, .042 * scale, .044 * scale); ctx.restore();
  circle(G.pivot.x, G.pivot.y, .014, '#162c3b', '#d0e0e6');
  circle(G.pivot.x, G.pivot.y, .007, '#e5c48b', '#4f3c21');
  const com = shape.centroid;
  if (state.cup > 5) { circle(com.x, com.y, .003, '#e7ce96cc'); }
}
function drawTray() {
  const y = G.trayY + state.trayOffset, left = G.trayX - G.trayWidth / 2, right = G.trayX + G.trayWidth / 2;
  // Spring under the moving pan; its rest position supports the dry pan.
  const spring = [{ x: G.trayX, y: y + .008 }], baseY = .823;
  for (let i = 0; i <= 12; i++) spring.push({ x: G.trayX + (i % 2 ? .018 : -.018), y: y + .016 + (baseY - y - .03) * i / 12 });
  spring.push({ x: G.trayX, y: baseY });
  line(spring, '#0a1925', 5); line(spring, '#8ba8b8', 2); segment(G.trayX - .07, baseY, G.trayX + .07, baseY, '#758e9c', 4);
  const fillHeight = state.tray / G.trayCapacity * G.trayHeight * .94;
  const polygon = [{ x: left + .006, y: y - fillHeight }, { x: right - .006, y: y - fillHeight }, { x: right - .006, y }, { x: left + .006, y }];
  path([{ x: left, y: y - G.trayHeight }, { x: left, y }, { x: right, y }, { x: right, y: y - G.trayHeight }], true); ctx.fillStyle = '#b6e4f00c'; ctx.fill();
  water(polygon, y - fillHeight, state.tray, G.trayHeight, .04);
  glass([{ x: left, y: y - G.trayHeight }, { x: left, y }, { x: right, y }, { x: right, y: y - G.trayHeight }], Math.max(2, scale * .0035));
  segment(right + .018, G.trayY, right + .018, G.trayY + G.trayTravel, '#7e9ba866');
  for (let i = 0; i < 5; i++) segment(right + .015, G.trayY + i * .018, right + .024, G.trayY + i * .018, '#99b5c077');
  segment(right + .012, y, right + .033, y, '#edd6a4', 2);
}
function draw() {
  ctx.setTransform(devicePixelRatio > 1.5 ? 1.5 : devicePixelRatio || 1, 0, 0, devicePixelRatio > 1.5 ? 1.5 : devicePixelRatio || 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, width, height); bg.addColorStop(0, '#304755'); bg.addColorStop(.55, '#213745'); bg.addColorStop(1, '#101e2b');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x += 56) { ctx.strokeStyle = '#cdeeff04'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 56) { ctx.strokeStyle = '#cdeeff04'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  const glow = ctx.createRadialGradient(px(.49), py(.39), 10, px(.49), py(.39), scale * .5); glow.addColorStop(0, '#5e9fba1c'); glow.addColorStop(1, '#5e9fba00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  const nozzle = input().sourceX;
  // Static metal source and support belong to the scene, not to the water path.
  segment(nozzle, -.05, nozzle, G.sourceY - .013, '#0b1a27', 15);
  segment(nozzle - .002, -.05, nozzle - .002, G.sourceY - .013, '#96acb7', 9);
  segment(nozzle - .013, G.sourceY - .013, nozzle + .013, G.sourceY - .013, '#cbdce2', 5);
  text('注水口', nozzle + .026, .035, '#acc5d1', 10);
  segment(G.pivot.x, G.pivot.y, G.pivot.x, .535, '#0b1d2b', 10);
  segment(G.pivot.x, G.pivot.y, G.pivot.x, .535, '#748e9c', 3);
  segment(G.pivot.x - .065, .535, G.pivot.x + .065, .535, '#91a9b3', 4);
  streams(); drawTray(); drawCup();
  text('支点', G.pivot.x - .02, .572, '#c4d7df', 10);
  text('水の重心', G.pivot.x + .105, .535, '#b6a484', 9);
  text('ばねで支えた受け皿', G.trayX, .55, '#a6c2cf', 10, 'center');
  if (width > 650) {
    text('水源', .07, .16, '#e0c99f', 10); text(`${f(Math.max(0, G.supply - state.injected))} ml`, .07, .192, '#d4e8ef', 19);
    text('残り / 2,400 ml', .07, .218, '#8aa8b8', 9);
    text('乾いた器の重心を', .07, .64, '#8aa8b8', 10); text('左のおもりで支える', .07, .665, '#8aa8b8', 10);
  }
}
function readouts() {
  const balance = massBalance(state);
  $('clock').textContent = `${f(state.time, 1)} s`;
  $('cup-volume').innerHTML = `${f(state.cup)}<small> ml</small>`;
  $('angle').innerHTML = `${f(state.angle * 180 / Math.PI, 1)}<small> °</small>`;
  $('spill').innerHTML = `${f(state.spillRate)}<small> ml/s</small>`;
  $('tray').innerHTML = `${f(state.tray)}<small> ml / </small>${f(state.trayOffset * 1000, 1)}<small> mm</small>`;
  $('balance').textContent = `注入 ${f(state.injected, 1)} = 器 ${f(state.cup, 1)} + 空中 ${f(balance.airborne, 1)} + 受け皿 ${f(state.tray, 1)} + 排水 ${f(state.lost, 1)} ml ｜ 収支誤差 ${balance.error.toExponential(1)} ml`;
  $('phase-fill').classList.toggle('active', state.cup > 1);
  $('phase-tip').classList.toggle('active', state.angle > .12);
  $('phase-catch').classList.toggle('active', state.tray > 1);
  if (running && state.injected >= G.supply) $('status').textContent = '水源が空になりました。残った水の動きを見てから、リセットで再び試せます。';
  $('stage-status').textContent = state.tray > 1 ? '受け皿に届いた水の重さが、ばねを押しています。' : state.spilled > 1 ? '縁を越えた水だけが、器から離れます。' : state.angle > .12 ? '水と器の重心が、支点の右へ。' : state.cup > 1 ? 'たまる水と、左のおもりがつり合っています。' : '注水をはじめると、水の重さで器が傾きます。';
}
function refreshInputs() {
  $('flow-value').value = `${$('flow').value} ml/s`;
  $('source-value').value = `${$('source').value} cm`;
  $('miss').textContent = Number($('source').value) === 20 ? '注水を器の上へ' : '注水を器の外へ';
  draw();
}
function setRunning(value, message) {
  running = value; lastFrame = 0; accumulator = 0;
  readouts();
  $('start').innerHTML = running ? '一時停止 <span>Ⅱ</span>' : state.time ? '続ける <span>▶</span>' : '連鎖をはじめる <span>▶</span>';
  $('status').textContent = message || (running ? '流量や注水口を変えて、反応を比べられます。' : '停止中です。水と器の動きは止まっています。');
}
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
  width = r.width; height = r.height; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const left = width < 650 ? .17 : .015, span = width < 650 ? .81 : 1.10;
  scale = Math.min(width / span, (height - 70) / .84);
  ox = (width - span * scale) / 2 - left * scale;
  oy = (height - .84 * scale) / 2;
  draw();
}
function frame(now) {
  const delta = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0; lastFrame = now;
  if (running && !document.hidden) {
    accumulator += delta;
    while (accumulator >= DT) { step(state, input()); accumulator -= DT; }
    draw();
    if (state.time - lastReadout >= .1) { readouts(); lastReadout = state.time; }
  }
  requestAnimationFrame(frame);
}
if (!ctx) {
  $('status').textContent = 'Canvas 2D を利用できません。このブラウザでは描画を開始できませんでした。';
  for (const e of document.querySelectorAll('button,input')) e.disabled = true;
} else {
  $('start').onclick = () => setRunning(!running);
  $('reset').onclick = () => { state = createState(); lastReadout = -1; setRunning(false, '水と時間をリセットしました。流量と注水口の設定はそのままです。'); readouts(); draw(); };
  for (const id of ['flow', 'source', 'pouring']) $(id).addEventListener('input', refreshInputs);
  $('miss').onclick = () => { $('source').value = Number($('source').value) === 20 ? 44 : 20; refreshInputs(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) setRunning(false, 'タブが非表示になったため停止しました。「続ける」で再開できます。'); });
  reduced.addEventListener('change', draw);
  new ResizeObserver(resize).observe(canvas); resize(); refreshInputs(); readouts(); requestAnimationFrame(frame);
  // Read-only diagnostics used by the browser checks; never advances the model.
  window.waterChain = Object.freeze({ snapshot: () => ({ ...structuredClone(state), running, balance: massBalance(state) }) });
  document.documentElement.dataset.ready = 'true';
}
