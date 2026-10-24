// Independent approximate mechanics. No dependency on src/ or allocation scores.
// Coordinates: metres, y down; volumes: ml; mass: kg (water 1 ml = .001 kg).
export const DT = 1 / 120;
export const GEOMETRY = Object.freeze({
  gravity: 9.81, depth: .035,
  pivot: Object.freeze({ x: .40, y: .36 }),
  left: -.11, right: .18, rim: -.10, floor: .07,
  maxAngle: 1.02, cupMass: .50, cupCOM: Object.freeze({ x: -.055, y: .005 }),
  dryInertia: .0045, damping: .035,
  trayX: .73, trayY: .69, trayWidth: .36, trayHeight: .065,
  trayCapacity: 950, trayMass: .35, spring: 155, trayDamping: 11, trayTravel: .075,
  sourceY: .065, supply: 2400,
});
const G = GEOMETRY;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function toWorld(x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: G.pivot.x + c * x - s * y, y: G.pivot.y + s * x + c * y };
}
function toLocal(p, angle) {
  const x = p.x - G.pivot.x, y = p.y - G.pivot.y;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c * x + s * y, y: -s * x + c * y };
}
export function cupPolygon(angle) {
  return [[G.left, G.rim], [G.right, G.rim], [G.right, G.floor], [G.left, G.floor]]
    .map(([x, y]) => toWorld(x, y, angle));
}
// Clip the rotated vessel by a horizontal, quasi-static free surface.
function below(polygon, level) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const insideA = a.y >= level, insideB = b.y >= level;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const f = (level - a.y) / (b.y - a.y);
      result.push({ x: a.x + f * (b.x - a.x), y: level });
    }
  }
  return result;
}
function properties(polygon) {
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-14) return { area: 0, x: G.pivot.x, y: G.pivot.y };
  return { area: Math.abs(twiceArea) / 2, x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}
export function waterShape(volume, angle) {
  const polygon = cupPolygon(angle);
  let lo = Math.min(...polygon.map(p => p.y)), hi = Math.max(...polygon.map(p => p.y));
  const target = Math.max(0, volume) / (G.depth * 1e6);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (properties(below(polygon, mid)).area > target) lo = mid;
    else hi = mid;
  }
  const level = (lo + hi) / 2, wet = below(polygon, level), props = properties(wet);
  const rim = toWorld(G.right, G.rim, angle);
  const capacity = properties(below(polygon, rim.y)).area * G.depth * 1e6;
  return { polygon: wet, level, centroid: { x: props.x, y: props.y }, capacity, rim };
}
export function createState() {
  return {
    time: 0, angle: 0, omega: 0, cup: 0, tray: 0, trayOffset: 0, trayVelocity: 0,
    particles: [], injected: 0, lost: 0, spilled: 0, caught: 0,
    spillRate: 0, inletRate: 0, torque: 0, firstTilt: null, firstSpill: null, firstCatch: null, lastCupHit: null,
  };
}
export function massBalance(state) {
  const airborne = state.particles.reduce((sum, p) => sum + p.volume, 0);
  return { airborne, error: state.injected - state.cup - state.tray - airborne - state.lost };
}
function controls(input) {
  const flow = input.flow ?? 180, sourceX = input.sourceX ?? .44;
  if (!Number.isFinite(flow) || flow < 0 || flow > 300) throw new RangeError('flow must be 0..300 ml/s');
  if (!Number.isFinite(sourceX) || sourceX < .15 || sourceX > .85) throw new RangeError('sourceX must be .15...85 m');
  return { flow: input.pouring === false ? 0 : flow, sourceX };
}

export function step(state, input = {}, dt = DT) {
  if (dt !== DT) throw new RangeError('Use the fixed 1/120 s step');
  const { flow, sourceX } = controls(input);
  const previousAngle = state.angle, previousTray = state.trayOffset;
  state.time += dt;
  const shape = waterShape(state.cup, state.angle);
  const dryCOM = toWorld(G.cupCOM.x, G.cupCOM.y, state.angle);
  const waterMass = state.cup * .001;
  state.torque = G.gravity * (G.cupMass * (dryCOM.x - G.pivot.x) + waterMass * (shape.centroid.x - G.pivot.x));
  const radius2 = (shape.centroid.x - G.pivot.x) ** 2 + (shape.centroid.y - G.pivot.y) ** 2;
  const inertia = G.dryInertia + waterMass * (radius2 + .008);
  const drag = G.damping * state.omega + .005 * state.omega * Math.abs(state.omega);
  state.omega += (state.torque - drag) / inertia * dt;
  state.angle += state.omega * dt;
  // Physical end stops; inelastic contact dissipates rather than adds energy.
  if (state.angle <= 0) { state.angle = 0; state.omega = Math.max(0, state.omega); }
  if (state.angle >= G.maxAngle) { state.angle = G.maxAngle; state.omega = Math.min(0, state.omega); }
  if (state.firstTilt === null && state.angle > .12) state.firstTilt = state.time;

  const force = state.tray * .001 * G.gravity - G.spring * state.trayOffset - G.trayDamping * state.trayVelocity;
  state.trayVelocity += force / (G.trayMass + state.tray * .001) * dt;
  state.trayOffset += state.trayVelocity * dt;
  if (state.trayOffset < 0) { state.trayOffset = 0; state.trayVelocity = Math.max(0, state.trayVelocity); }
  if (state.trayOffset > G.trayTravel) { state.trayOffset = G.trayTravel; state.trayVelocity = Math.min(0, state.trayVelocity); }

  const amount = Math.min(flow * dt, Math.max(0, G.supply - state.injected));
  state.inletRate = amount / dt;
  if (amount > 0) {
    state.injected += amount;
    state.particles.push({ x: sourceX, y: G.sourceY, vx: 0, vy: .12, volume: amount, kind: 'inlet' });
  }
  // Broad-crested weir approximation, limited by retained inventory.
  const current = waterShape(state.cup, state.angle);
  const head = Math.max(0, current.rim.y - current.level);
  const excess = Math.max(0, state.cup - current.capacity);
  const weir = (2 / 3) * .62 * G.depth * Math.sqrt(2 * G.gravity) * head ** 1.5 * 1e6;
  const out = Math.min(state.cup, excess, weir * dt);
  state.spillRate = out / dt;
  if (out > 1e-9) {
    state.cup -= out; state.spilled += out;
    if (state.firstSpill === null) state.firstSpill = state.time;
    const rim = current.rim, dx = rim.x - G.pivot.x, dy = rim.y - G.pivot.y;
    const speed = Math.sqrt(2 * G.gravity * head);
    state.particles.push({ x: rim.x + .002, y: rim.y + .002,
      vx: Math.cos(state.angle) * speed - state.omega * dy,
      vy: Math.sin(state.angle) * speed + state.omega * dx,
      volume: out, kind: 'spill' });
  }

  const flying = [];
  for (const p of state.particles) {
    const before = { x: p.x, y: p.y };
    p.x += p.vx * dt;
    p.y += p.vy * dt + .5 * G.gravity * dt * dt;
    p.vy += G.gravity * dt;
    if (p.kind === 'inlet') {
      // Capture only a downward crossing of the moving mouth, not nearby water.
      const a = toLocal(before, previousAngle), b = toLocal(p, state.angle);
      if (a.y <= G.rim && b.y > G.rim) {
        const f = (G.rim - a.y) / (b.y - a.y), x = a.x + f * (b.x - a.x);
        if (x > G.left && x < G.right) {
          state.cup += p.volume; state.lastCupHit = { x: p.x, time: state.time }; continue;
        }
      }
    }
    const topBefore = G.trayY + previousTray - G.trayHeight;
    const topAfter = G.trayY + state.trayOffset - G.trayHeight;
    if (before.y <= topBefore && p.y > topAfter) {
      const a = before.y - topBefore, b = p.y - topAfter;
      const f = -a / (b - a), x = before.x + f * (p.x - before.x);
      if (Math.abs(x - G.trayX) < G.trayWidth / 2) {
        const caught = Math.min(p.volume, Math.max(0, G.trayCapacity - state.tray));
        state.tray += caught; state.caught += caught; state.lost += p.volume - caught;
        if (caught > 0 && state.firstCatch === null) state.firstCatch = state.time;
        continue;
      }
    }
    if (p.y > .84 || p.x < -.1 || p.x > 1.3) state.lost += p.volume;
    else flying.push(p);
  }
  state.particles = flying;
  return state;
}
