import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, DT, GEOMETRY as G, waterShape, massBalance } from '../game/water-chain-model.js';

function run(seconds, input, state = createState()) {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(state, typeof input === 'function' ? input(i, state) : input);
  return state;
}
function conserved(s) {
  assert.ok(Math.abs(massBalance(s).error) < 1e-7, `mass error ${massBalance(s).error}`);
}

test('upright water depth and centroid match a rectangular vessel', () => {
  const shape = waterShape(1000, 0);
  const expectedDepth = .001 / (G.depth * (G.right - G.left));
  assert.ok(Math.abs(shape.level - (G.pivot.y + G.floor - expectedDepth)) < 1e-9);
  assert.ok(Math.abs(shape.centroid.x - (G.pivot.x + (G.left + G.right) / 2)) < 1e-9);
  assert.ok(Math.abs(shape.capacity - 1725.5) < 1e-8);
  assert.ok(waterShape(1000, .8).centroid.x > shape.centroid.x);
  assert.ok(waterShape(1000, .8).capacity < shape.capacity);
});
test('no water means no triggered motion, including a closed valve', () => {
  for (const input of [{ flow: 0 }, { flow: 300, pouring: false }]) {
    const s = run(30, input);
    assert.equal(s.angle, 0); assert.equal(s.trayOffset, 0); assert.equal(s.injected, 0);
    assert.equal(s.firstTilt, null); assert.equal(s.firstCatch, null); conserved(s);
  }
});
test('water aimed outside the vessel does not tip it or move the receiver', () => {
  const s = run(20, { flow: 180, sourceX: .20 });
  assert.equal(s.cup, 0); assert.equal(s.angle, 0); assert.equal(s.tray, 0); assert.equal(s.trayOffset, 0);
  assert.equal(s.lost, G.supply); conserved(s);
});
test('lower inflow delays tilt and the receiver follows actual spilling', () => {
  const normal = run(20, { flow: 180 }), slow = run(20, { flow: 60 });
  for (const s of [normal, slow]) {
    assert.ok(s.firstTilt > 0 && s.firstTilt < s.firstSpill && s.firstSpill < s.firstCatch);
    assert.ok(s.tray > 0 && s.trayOffset > 0); assert.ok(s.spilled > s.tray); conserved(s);
  }
  assert.ok(slow.firstTilt > normal.firstTilt * 2);
});
test('closing the valve stops new mass, keeping airborne water until arrival', () => {
  const s = run(3, { flow: 180 }), injected = s.injected, cup = s.cup;
  run(1, { flow: 180, pouring: false }, s);
  assert.equal(s.injected, injected); assert.ok(s.cup > cup); conserved(s);
  run(10, { flow: 0 }, s);
  assert.equal(s.firstTilt, null); assert.equal(s.angle, 0); conserved(s);
});
test('steps are reproducible and a new state restarts the full chain', () => {
  const a = run(15, { flow: 180 }), b = run(15, { flow: 180 });
  assert.deepEqual(a, b);
  assert.equal(createState().injected, 0); assert.equal(createState().time, 0);
});
test('120 seconds with changing controls stays finite, bounded and conservative every step', () => {
  const s = createState();
  for (let i = 0; i < 120 / DT; i++) {
    step(s, { flow: i % 1920 < 960 ? 300 : 20, sourceX: i % 2400 < 1600 ? .44 : .80, pouring: i % 1500 < 1200 });
    for (const key of ['angle', 'omega', 'cup', 'tray', 'trayOffset', 'trayVelocity', 'injected', 'lost', 'spillRate']) assert.ok(Number.isFinite(s[key]), key);
    assert.ok(s.cup >= 0 && s.tray >= 0 && s.tray <= G.trayCapacity);
    assert.ok(s.angle >= 0 && s.angle <= G.maxAngle);
    assert.ok(s.trayOffset >= 0 && s.trayOffset <= G.trayTravel);
    assert.ok(s.injected <= G.supply && s.lost >= 0);
    assert.ok(s.particles.length < 240);
    conserved(s);
  }
});
test('invalid inputs fail explicitly rather than poison the simulation', () => {
  for (const input of [{ flow: NaN }, { flow: 301 }, { flow: -1 }, { sourceX: Infinity }, { sourceX: .1 }]) assert.throws(() => step(createState(), input), RangeError);
  assert.throws(() => step(createState(), {}, 1), RangeError);
});
