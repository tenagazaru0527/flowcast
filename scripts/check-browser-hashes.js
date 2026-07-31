import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { runSimulation } from "../src/simulation.js";
import { createReplay, replayInput } from "../src/scenarios.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reports = new Map();
const waiters = new Map();

function contentType(pathname) {
  const extension = extname(pathname);
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".html") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/report" && request.method === "POST") {
    const runtime = url.searchParams.get("runtime");
    const hash = url.searchParams.get("hash");
    reports.set(runtime, hash);
    if (waiters.has(runtime)) waiters.get(runtime)(hash);
    response.writeHead(204);
    response.end();
    return;
  }

  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const path = resolve(root, relative);
  if (!path.startsWith(`${root}/`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { "content-type": contentType(path) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

function listen() {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
  });
}

async function executable(candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed candidate list; no directory iteration is used.
    }
  }
  return null;
}

function waitForReport(runtime, timeoutMilliseconds) {
  if (reports.has(runtime)) return Promise.resolve(reports.get(runtime));
  return new Promise((resolveReport, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${runtime} did not report a hash`)), timeoutMilliseconds);
    waiters.set(runtime, (hash) => {
      clearTimeout(timeout);
      waiters.delete(runtime);
      resolveReport(hash);
    });
  });
}

async function runBrowser(runtime, binary, args, url) {
  const child = spawn(binary, [...args, `${url}?runtime=${runtime}`], { stdio: "ignore" });
  try {
    return await waitForReport(runtime, 60_000);
  } finally {
    child.kill("SIGTERM");
  }
}

const chrome = await executable([
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
]);
const firefox = await executable([
  process.env.FIREFOX_BIN,
  "/usr/bin/firefox",
  "/usr/bin/firefox-esr",
]);

if (!chrome && !firefox) {
  console.error("browser executables missing: Chrome and Firefox");
  process.exitCode = 1;
} else {
  const port = await listen();
  const url = `http://127.0.0.1:${port}/`;
  const nodeHash = runSimulation(replayInput(createReplay())).stateHash;
  try {
    const chromeHash = chrome
      ? await runBrowser("chrome", chrome, ["--headless=new", "--no-sandbox", "--disable-gpu"], url)
      : null;
    const firefoxHash = firefox
      ? await runBrowser("firefox", firefox, ["--headless"], url)
      : null;
    console.log(`Node=${nodeHash} Chrome=${chromeHash ?? "missing"} Firefox=${firefoxHash ?? "missing"}`);
    if (!chromeHash || !firefoxHash || nodeHash !== chromeHash || nodeHash !== firefoxHash) process.exitCode = 1;
  } finally {
    server.close();
  }
}
