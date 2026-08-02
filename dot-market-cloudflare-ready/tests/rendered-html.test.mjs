import assert from "node:assert/strict";
import test from "node:test";

// The home page is server-rendered and reads the shop list from D1. With no
// binding supplied, listPublicShops() must fall back to an empty list rather
// than blowing up the response — that fallback is what this exercises.
async function renderHome() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("home page renders as HTML", async () => {
  const response = await renderHome();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
});

test("home page carries its headline, price table and FAQ", async () => {
  const html = await (await renderHome()).text();

  assert.match(html, /캔버스 한 장은 32×32/, "hero headline missing");
  assert.match(html, /주문까지 네 단계/, "steps section missing");
  assert.match(html, /70,000원/, "worked price example missing");
  assert.match(html, /화가 이젤이 뭔가요/, "FAQ missing");
  assert.match(html, /쓸 수 있는 색은 197개/, "palette count missing or stale");
});
