// No browser-testing dependency: run against the Node 24 + Chrome in GitHub Actions.
// The real Jeview server has no Jev key, so this cannot call TypeSafe or dispatch any agent.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createJeview } from "../src/jeview.ts";

const executable = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find((name) => spawnSync("which", [name], { encoding: "utf8" }).status === 0);
if (!executable) throw Error("Browser smoke requires Chrome or Chromium; not a pass/skip without a browser.");

const dir = mkdtempSync(join(tmpdir(), "jeview-browser-"));
const profile = mkdtempSync(join(tmpdir(), "jeview-chrome-"));
const snapshotPath = join(dir, "loop-private.json");
const fixture = {
  format: "jeview.things-loop/v1", exportedAt: new Date().toISOString(),
  source: { name: "Things Loop", kind: "local_export", authority: "unverified", revision: "a".repeat(64),
    files: [{ path: "data/dogfood-note.yaml", sha256: "b".repeat(64) },
      { path: "system-graph/graph.json", sha256: "c".repeat(64) }] },
  nodes: [
    { id: "note:TEST0000000000000001", type: "note", label: "Example Things case",
      properties: { intent_labels: ["Scope"] },
      source: { path: "data/dogfood-note.yaml", id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "case:TEST0000000000000001", type: "case", label: "Example Things case",
      properties: { stage: "scoped", destination: "things_case" },
      source: { path: "data/dogfood-composite.yaml", id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "phase:TEST0000000000000001:1", type: "phase", label: "Scope",
      properties: { phase_order: 1, intent: "Scope" },
      source: { path: "data/dogfood-composite.yaml", id: "TEST0000000000000001" }, evidence: "record", status: "snapshot" },
    { id: "sys:p-route", type: "process", label: "Route a Case",
      properties: { kind: "process", perspective: "processes", detail: "Historical process only" },
      source: { path: "system-graph/graph.json", id: "p-route" }, evidence: "declared", status: "historical" },
    { id: "sys:p-store", type: "store", label: "Case records",
      properties: { kind: "store", perspective: "records", detail: "Historical dependency" },
      source: { path: "system-graph/graph.json", id: "p-store" }, evidence: "observed", status: "historical" },
  ],
  edges: [
    { from: "case:TEST0000000000000001", to: "note:TEST0000000000000001", type: "based_on",
      rationale: "", source: { path: "data/dogfood-composite.yaml", index: 0 }, evidence: "record" },
    { from: "case:TEST0000000000000001", to: "phase:TEST0000000000000001:1", type: "has_phase",
      rationale: "", source: { path: "data/dogfood-composite.yaml", index: 1 }, evidence: "record" },
    { from: "sys:p-route", to: "sys:p-store", type: "reads",
      rationale: "Historical source statement", source: { path: "system-graph/graph.json", index: 0 }, evidence: "observed" },
  ],
  counts: { notes: 1, cases: 1, phases: 1, links: 0, components: 2, system_links: 1 },
  warnings: { unresolved_links: 0 },
};
writeFileSync(snapshotPath, JSON.stringify(fixture));
const { server, store } = createJeview({ dir, thingsLoopSnapshot: snapshotPath });
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
    Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]), "Chrome DevTools port", 30000); // Parallel CI Chrome startup can be slow.
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
  await retry(() => evaluate('document.querySelector("#view-loop")?.getAttribute("aria-pressed") === "true"'), "source-backed Object Map becomes primary");
  await retry(() => evaluate('window.JeviewLoopGraph.sourceInfo().connected'), "Object Map source adapter connected");
  assert.equal(await evaluate('document.querySelector("#view-decisions")?.getAttribute("aria-pressed")'), "false");
  assert.equal(await evaluate('window.JeviewLoopGraph.all().length'), 5);
  await evaluate('document.querySelector("#view-decisions").click()');
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
  // The object map must show every type, not just a selected Case.
  await evaluate('window.__canvasWords = []; document.querySelector("#view-loop").click()');
  await retry(() => evaluate('window.JeviewLoopGraph.mode() === "catalog" && window.JeviewLoopGraph.visible().length === 5'), "all source-backed objects appear on the canvas");
  await retry(() => evaluate('document.querySelector("#corner").textContent.includes("All objects") && document.querySelectorAll("#corner .loop-chip").length >= 4'), "typed inventory and facet controls");
  const count = await evaluate('window.JeviewLoopGraph.facets().map(x => x.type).sort().join(",")');
  assert.equal(count, "case,note,phase,process,store");
  await evaluate('document.querySelector("#corner .loop-list button").click()');
  assert.equal(await evaluate('window.JeviewLoopGraph.center()?.type'), "case");
  await retry(() => evaluate('window.__canvasWords.some(text => text.includes("CASE"))'), "Case nodes drawn on original canvas");
  // The existing canvas transforms view position/scale, then the centered focused object.
  const point = await evaluate('(() => { const t = window.__moves.slice(-2), k = window.__zoom; return [t[0][0] + t[1][0] * k, t[0][1] + t[1][1] * k]; })()');
  await evaluate('document.querySelector("#map").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: ' + point[0] + ', clientY: ' + point[1] + ' }))');
  await retry(() => evaluate('document.querySelector("#drawer").classList.contains("open") && document.querySelector("#drawer-body").textContent.includes("Example Things case") && document.querySelector("#drawer-body").textContent.includes("has phase")'), "source-record Case inspector with typed relationships");
  assert.equal(await evaluate('window.JeviewLoopGraph.sourceInfo().authority'), "unverified");
  await evaluate('document.querySelector("#view-processes").click()');
  await retry(() => evaluate('document.querySelector("#corner").textContent.includes("Route a Case") && window.JeviewLoopGraph.center().type === "process"'), "historical process inspection");
  await evaluate('document.querySelector("#view-observe").click()');
  await retry(() => evaluate('document.querySelector("#corner").textContent.includes("NOT LIVE") && document.querySelector("#corner").textContent.includes("reads")'), "historical observation is never claimed live");
  await evaluate('document.querySelector("#view-simulate").click()');
  await retry(() => evaluate('document.querySelector("#corner #loop-process-form")'), "process editor appears");
  await evaluate('document.querySelector("#corner #loop-process-form button[type=button]").click()'); // + Step
  await retry(() => evaluate('document.querySelectorAll("#corner .loop-step").length === 2'), "editor composes a second effect");
  // The first step passes (scoped -> working); the second can match the new overlay.
  await evaluate('document.querySelector("[name=guard_1]").value = "stage_is"; document.querySelector("[name=guard_value_1]").value = "working"; document.querySelector("[name=effect_1]").value = "set_stage"; document.querySelector("[name=effect_value_1]").value = "blocked"');
  await evaluate('Array.from(document.querySelectorAll("#corner .loop-actions button")).find(x => x.textContent === "Play").click()');
  await retry(() => evaluate('window.JeviewLoopWorkspace.status().phase === "completed"'), "sandbox process event/guard/effect completes", 10000);
  assert.equal(await evaluate('window.JeviewLoopGraph.overlayFor("case:TEST0000000000000001")?.stage'), "blocked");
  await retry(() => evaluate('document.querySelector("#corner").textContent.includes("SIMULATED") || document.querySelector("#corner").textContent.includes("simulated")'), "simulated event trace visible");
  await evaluate('Array.from(document.querySelectorAll("#corner .loop-actions button")).find(x => x.textContent === "Reset").click()');
  assert.equal(await evaluate('window.JeviewLoopGraph.overlayFor("case:TEST0000000000000001")'), null);
  // Mobile layout: the object controls must still be reachable after rescaling.
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate('document.querySelector("#view-loop").click()');
  await retry(() => evaluate('document.querySelector("#view-loop").getBoundingClientRect().width > 0'), "mobile viewport renders Objects control");
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate('document.querySelector("#view-decisions").click()');
  assert.equal(await evaluate('document.querySelector("#view-decisions").getAttribute("aria-pressed")'), "true");
  assert.equal(store.count(), 0, "rendering, simulation and replay cannot call Jev");
  console.log("Browser smoke passed: live Jev preserved, native all-object map/facets/inspector, process view, historical Observe, multi-step simulated effect and mobile controls.");
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
