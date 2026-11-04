// No browser-testing dependency: run against the Node 24 + Chrome in GitHub Actions.
// The real Jeview server has no Jev key, so this cannot call TypeSafe or dispatch any agent.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createJeview } from "../src/jeview.ts";

const executable = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find((name) => spawnSync("which", [name], { encoding: "utf8" }).status === 0);
if (!executable) throw Error("Browser smoke requires Chrome or Chromium; not a pass/skip without a browser.");

const dir = mkdtempSync(join(tmpdir(), "jeview-browser-"));
const profile = mkdtempSync(join(tmpdir(), "jeview-chrome-"));
const { server, store } = createJeview({ dir });
let chrome, ws;
const retry = async (fn, label, limit = 12000) => {
  const end = Date.now() + limit;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { last = e; }
    await sleep(120);
  }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ""}`);
};
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  chrome = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`,
  ], { stdio: "ignore" });
  chrome.on("error", () => {}); // The timed readiness check below reports startup failure.
  const debugPort = await retry(() => existsSync(join(profile, "DevToolsActivePort")) &&
    Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]), "Chrome DevTools port");
  const endpoint = await retry(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return pages.find((page) => page.type === "page" && page.url.includes(`127.0.0.1:${port}`))?.webSocketDebuggerUrl;
  }, "Jeview tab");
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)), p = pending.get(message.id);
    if (p) { pending.delete(message.id); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  await retry(() => evaluate('document.querySelector("#map")?.classList.contains("ready")'), "viewer becomes ready");
  assert.equal(await evaluate('document.querySelector("#view-decisions")?.getAttribute("aria-pressed")'), "true");
  assert.equal(await evaluate('document.querySelector("#view-context")?.getAttribute("aria-pressed")'), "false");
  await evaluate(`(() => {
    window.__canvasWords = [];
    window.__moves = [];
    window.__zoom = 1;
    const proto = CanvasRenderingContext2D.prototype;
    const write = proto.fillText, translate = proto.translate, scale = proto.scale;
    proto.fillText = function(label, ...args) {
      if (typeof label === "string" && window.__canvasWords.length < 3000) window.__canvasWords.push(label);
      return write.call(this, label, ...args);
    };
    proto.translate = function(x, y) {
      window.__moves.push([x, y]); if (window.__moves.length > 12) window.__moves.shift();
      return translate.call(this, x, y);
    };
    proto.scale = function(x, y) { window.__zoom = x; return scale.call(this, x, y); };
    return true;
  })()`);
  await evaluate('document.querySelector("#view-context").click()');
  await retry(() => evaluate('window.__canvasWords.includes("Repository")'), "Context nodes drawn on original canvas");
  assert.equal(await evaluate('document.querySelector("#view-context").getAttribute("aria-pressed")'), "true");
  assert.equal(await evaluate('document.querySelector("#nokey").hidden'), true);
  const clickNode = async (id) => {
    // The existing renderer transforms view position/scale and then the Jev origin.
    const position = await evaluate(`(() => {
      const t = window.__moves.slice(-2), k = window.__zoom;
      const n = window.JeviewSampleGraph.nodeById(document.querySelector("#view-context").getAttribute("aria-pressed") === "true" ? "context" : "harness", "${id}");
      return [t[0][0] + k * (t[1][0] + n.x), t[0][1] + k * (t[1][1] + n.y)];
    })()`);
    await evaluate(`document.querySelector("#map").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: ${position[0]}, clientY: ${position[1]} }))`);
  };
  await clickNode("repo");
  await retry(() => evaluate('document.querySelector("#drawer").classList.contains("open") && document.querySelector("#drawer-body").textContent.includes("Repository")'), "Context node inspection");
  await evaluate('document.querySelector("#view-harness").click()');
  await retry(() => evaluate('window.__canvasWords.includes("Agent")'), "Harness nodes drawn on original canvas");
  await clickNode("agent");
  await retry(() => evaluate('document.querySelector("#drawer-body").textContent.includes("Agent") && document.querySelector("#drawer-body").textContent.includes("Synthetic sample")'), "Agent inspector reflects sample provenance");
  await evaluate('document.querySelector("#view-decisions").click()');
  assert.equal(await evaluate('document.querySelector("#view-decisions").getAttribute("aria-pressed")'), "true");
  console.log("Browser smoke passed: default live decisions, sample context/harness rendering, click inspector, and return to decisions.");
} finally {
  ws?.close();
  if (chrome) {
    chrome.kill();
    // A Chrome helper may still be writing into the temporary profile after SIGTERM.
    if (chrome.exitCode === null && chrome.signalCode === null) {
      await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(2000)]);
    }
  }
  await new Promise((resolve) => server.close(resolve));
  store.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 120 });
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
