import assert from "node:assert/strict";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());

const host = {
  online: true,
  metrics: {
    timestamp: 1800000000,
    gpus: [
      { name: "GPU A", temperature: 0 },
      { name: "GPU B", temperature: -2 },
      { name: "Missing", temperature: null },
      { name: "Invalid", temperature: NaN },
    ],
    disks: [
      {
        name: "sda",
        model: "Disk A",
        temperature: 32,
        smart_updated_at: 1799990000,
      },
      { name: "sdb", model: "Disk B", temperature: 41 },
    ],
  },
};

test("shows every finite temperature with device identity and honest measurement times", async () => {
  const { TemperatureReadings } = await server.ssrLoadModule(
    "/src/components/temperature-readings.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(TemperatureReadings, { host }),
  );
  for (const text of [
    "GPU A",
    "GPU B",
    "sda",
    "sdb",
    "0 °C",
    "-2 °C",
    "32 °C",
    "41 °C",
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /Сохранённый замер/);
  assert.match(html, /Время замера неизвестно/);
  assert.doesNotMatch(html, /NaN|Missing|Invalid/);
});

test("offline readings are marked saved and an empty host never gets a zero temperature", async () => {
  const { TemperatureReadings } = await server.ssrLoadModule(
    "/src/components/temperature-readings.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(TemperatureReadings, {
      host: { ...host, online: false },
    }),
  );
  assert.match(html, /Сохранённые температуры/);
  const empty = renderToStaticMarkup(
    React.createElement(TemperatureReadings, {
      host: { online: false, metrics: null },
    }),
  );
  assert.match(empty, /Температуры: нет данных/);
  assert.doesNotMatch(empty, /0 °C/);
});

test("temperature chart rows keep missing devices null and insert breaks across absent buckets", async () => {
  const { temperatureRows } = await server.ssrLoadModule(
    "/src/temperatures.ts",
  );
  const records = [
    { bucket: 0, values: { a: 0, b: -2 } },
    { bucket: 300, values: { a: 10 } },
    { bucket: 1200, values: { a: 30, b: 32 } },
  ];
  assert.deepEqual(temperatureRows(records, ["a", "b"], 1), [
    { bucket: 0, a: 0, b: -2 },
    { bucket: 300, a: 10, b: null },
    { bucket: 600, a: null, b: null },
    { bucket: 1200, a: 30, b: 32 },
  ]);
  assert.deepEqual(
    temperatureRows([{ bucket: 0, values: { a: NaN } }], ["a"], 7),
    [{ bucket: 0, a: null }],
  );
});

test("temperature legend can hide series but never hides the last visible device", async () => {
  const { toggleTemperature } = await server.ssrLoadModule(
    "/src/temperatures.ts",
  );
  assert.deepEqual(toggleTemperature([], "a", ["a", "b"]), ["a"]);
  assert.deepEqual(toggleTemperature(["a"], "b", ["a", "b"]), ["a"]);
  assert.deepEqual(toggleTemperature(["a"], "a", ["a", "b"]), []);
});
