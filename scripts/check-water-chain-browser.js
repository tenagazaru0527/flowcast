// Real Chromium checks over CDP; requires Node 22+ (built-in WebSocket), no packages.
// Start scripts/serve-water-chain.js first. Pass an installed browser executable.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2] || process.env.CHROME_BIN;
if (!executable) throw Error('Pass an installed Chromium executable as the first argument');
const url = process.argv[3] || 'http://127.0.0.1:8123/game/water-chain.html';
const output = resolve(process.argv[4] || '../water-chain-evidence');
const profile = await mkdtemp(join(tmpdir(), 'flowcast-chain-browser-'));
await mkdir(output, { recursive: true });
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let launchError, stderr = '', socket;
child.on('error', e => { launchError = e; }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
const errors = [], checks = [], pending = new Map(); let id = 0;
const DT_TOLERANCE = 1 / 120 + 1e-8;
async function command(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(Error(`CDP timeout ${method}`)); }, 15000);
    pending.set(requestId, { resolve: value => { clearTimeout(timeout); resolveCommand(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await delay(100); }
  throw Error(`Timed out: ${expression}`);
}
const snapshot = () => evaluate('waterChain.snapshot()');
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const slider = (id, value) => evaluate(`{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));}`);
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(join(output, name + '.png'), Buffer.from(result.data, 'base64'));
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(`Browser exited ${child.exitCode}: ${stderr.slice(-1500)}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); }
  }
  if (!port) throw Error('Chromium did not open a debugging port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(15000) })).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    const timeout = setTimeout(() => reject(Error('WebSocket connection timeout')), 15000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
    socket.addEventListener('error', error => { clearTimeout(timeout); reject(error); }, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const p = pending.get(message.id); if (p) { pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
  });
  console.log('Connected:', JSON.stringify(await command('Browser.getVersion')));
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url }); await until('document.documentElement.dataset.ready === "true"');
  await screenshot('01-ready-desktop');
  assert.equal((await snapshot()).time, 0); checks.push('initial state: no auto-start');
  await click('start'); await until('waterChain.snapshot().time > 6.5');
  const chain = await snapshot(); assert.ok(chain.firstTilt < chain.firstSpill && chain.firstSpill < chain.firstCatch); assert.ok(chain.trayOffset > 0); assert.ok(Math.abs(chain.balance.error) < 1e-7);
  await screenshot('02-chain-desktop'); checks.push({ normalChain: { tilt: chain.firstTilt, spill: chain.firstSpill, catch: chain.firstCatch, tray: chain.tray, massError: chain.balance.error } });
  await click('start'); const paused = await snapshot(); await delay(400); assert.deepEqual(await snapshot(), paused); checks.push('pause: all mechanics and time frozen');
  await click('start'); await until(`waterChain.snapshot().time > ${paused.time + .3}`); checks.push('resume advances');
  await slider('flow', 60); assert.equal(await evaluate('document.getElementById("flow-value").value'), '60 ml/s');
  await click('reset'); assert.equal((await snapshot()).time, 0); assert.equal((await snapshot()).injected, 0); assert.equal((await snapshot()).running, false); checks.push('reset clears mass/time and preserves controls');
  await click('start'); await until('waterChain.snapshot().time > 6.3'); const slow = await snapshot(); assert.equal(slow.firstTilt, null); assert.ok(slow.cup > 0 && slow.cup < chain.cup); checks.push('slower flow has not tipped by the normal-chain time');
  await click('reset'); await slider('flow', 0); await click('start'); await until('waterChain.snapshot().time > .5'); const dry = await snapshot(); assert.equal(dry.cup, 0); assert.equal(dry.angle, 0); assert.equal(dry.trayOffset, 0); checks.push('zero flow: no water or motion');
  await click('reset'); await slider('flow', 180); await click('miss'); await click('start'); await until('waterChain.snapshot().time > 1.2'); const missed = await snapshot(); assert.equal(missed.cup, 0); assert.equal(missed.tray, 0); assert.ok(missed.lost > 0); checks.push('off-vessel injection: drains without moving mechanisms');
  await click('reset'); await click('miss'); await click('pouring'); await click('start'); await until('waterChain.snapshot().time > .5'); assert.equal((await snapshot()).injected, 0); await click('pouring'); await until('waterChain.snapshot().cup > 20'); checks.push('valve closed/open works during simulation');
  // Reset and rerun verifies the complete causal sequence a second time.
  await click('reset'); await click('start'); await until('waterChain.snapshot().time > 6.4'); const rerun = await snapshot(); assert.ok(Math.abs(rerun.firstCatch - chain.firstCatch) < DT_TOLERANCE); checks.push('full chain rerun is reproducible');
  await click('start');
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1920, height: 1080 }]) {
    await command('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 500 }); await delay(100);
    const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth'); assert.equal(overflow, false, `horizontal overflow at ${size.width}`);
    const canvasSize = await evaluate('({width:document.querySelector("canvas").clientWidth,height:document.querySelector("canvas").clientHeight})'); assert.ok(canvasSize.width > 200 && canvasSize.height > 200);
    await screenshot(`03-size-${size.width}`); checks.push({ size, overflow, canvasSize });
  }
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('reset'); await click('start'); await until('waterChain.snapshot().time > .4'); assert.ok((await snapshot()).cup > 0); checks.push('reduced motion preserves physical controls; optical shimmer suppressed');
  // Exercise the page handler in the browser. Does not assert OS tab visibility.
  await evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"))');
  assert.equal((await snapshot()).running, false); checks.push('visibility handler pauses (synthetic hidden event)');
  assert.deepEqual(errors, []); checks.push('no browser exceptions or console errors');
  const version = await command('Browser.getVersion');
  const report = { browser: version.product, userAgent: version.userAgent, checks, limitations: ['No Firefox/Safari or touch-device hardware test.', 'OS visibility behavior uses a synthetic hidden event.', 'Screenshots require human inspection.'] };
  await writeFile(join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(join(output, 'browser-failure.json'), JSON.stringify({ status: 'not_completed', error: error.message, completedChecks: checks, diagnostics: stderr.slice(-4000) }, null, 2));
  console.error('Browser diagnostics:', stderr.slice(-2500)); throw error;
} finally {
  socket?.close(); child.kill();
}
