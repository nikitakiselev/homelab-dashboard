import assert from "node:assert/strict";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());

async function render(values) {
  const { ResourceRings } = await server.ssrLoadModule(
    "/src/components/resource-rings.tsx",
  );
  return renderToStaticMarkup(
    React.createElement(ResourceRings, {
      resources: ["CPU", "RAM", "GPU"].map((label, index) => ({
        label,
        value: values[index],
        detail: `${label} details`,
      })),
    }),
  );
}

function progressRings(html) {
  return [
    ...html.matchAll(/<g\b[^>]*role="progressbar"[^>]*>[\s\S]*?<\/g>/g),
  ].map(([ring]) => ring);
}

test("shows independent CPU, RAM and GPU percentages as concentric rings", async () => {
  const html = await render([25, 50, 75]);
  const rings = progressRings(html);
  assert.equal(rings.length, 3);
  for (const [index, value] of [25, 50, 75].entries()) {
    assert.match(rings[index], new RegExp(`aria-valuenow="${value}"`));
    assert.match(
      rings[index],
      new RegExp(`stroke-dashoffset="${100 - value}"`),
    );
    assert.match(html, new RegExp(`<dd\\b[^>]*>${value}%</dd>`));
  }
  assert.match(rings[0], /aria-label="Загрузка CPU"/);
  assert.match(rings[1], /aria-label="Занятая память"/);
  assert.match(rings[2], /aria-label="Загрузка GPU"/);
  const radii = rings.map((ring) =>
    Number(ring.match(/<circle[^>]* r="([^"]+)"/)[1]),
  );
  assert.ok(radii[0] > radii[1] && radii[1] > radii[2]);
});

test("keeps missing metrics unavailable instead of drawing zero usage", async () => {
  const html = await render([null, undefined, NaN]);
  assert.equal(progressRings(html).length, 0);
  assert.equal((html.match(/Нет данных/g) || []).length, 3);
  assert.equal((html.match(/<dd\b[^>]*>—<\/dd>/g) || []).length, 3);
  assert.doesNotMatch(html, /NaN|0%|stroke-dashoffset/);
});

test("distinguishes real zero from unavailable GPU data", async () => {
  const html = await render([0, 60, null]);
  const rings = progressRings(html);
  assert.equal(rings.length, 2);
  assert.match(rings[0], /aria-valuenow="0"/);
  assert.match(rings[0], /stroke-dashoffset="100"/);
  assert.match(html, /0%/);
  assert.match(html, /GPU: Нет данных/);
});

test("bounds ring geometry and accessible values to the percentage range", async () => {
  const rings = progressRings(await render([-10, 120, 100]));
  assert.match(rings[0], /aria-valuenow="0"/);
  assert.match(rings[0], /stroke-dashoffset="100"/);
  assert.match(rings[1], /aria-valuenow="100"/);
  assert.match(rings[1], /stroke-dashoffset="0"/);
  assert.match(rings[2], /aria-valuenow="100"/);
});
