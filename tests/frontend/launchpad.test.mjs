import assert from "node:assert/strict";
import test from "node:test";
import {
  recognizeApplication,
  externalAccessLabel,
  filterApplications,
  orderedApplications,
} from "../../frontend/src/components/launchpad-data.ts";

test("recognizes known apps by name or URL path without guessing by port", () => {
  assert.equal(
    recognizeApplication("My Plex", "http://192.168.50.12:4000")?.id,
    "plex",
  );
  assert.equal(
    recognizeApplication("", "https://apps.example/grafana/")?.id,
    "grafana",
  );
  assert.equal(
    recognizeApplication("", "https://gitea.example/")?.name,
    "Gitea",
  );
  assert.equal(
    recognizeApplication("Media", "http://192.168.50.12:7878"),
    null,
  );
});

test("avoids brand substrings and query parameters masquerading as an app", () => {
  assert.equal(recognizeApplication("notgitea", "https://example.test"), null);
  assert.equal(
    recognizeApplication("", "https://example.test/?next=grafana"),
    null,
  );
  assert.equal(recognizeApplication("Дом", "invalid"), null);
  assert.equal(
    recognizeApplication("Home Assistant", "")?.id,
    "home-assistant",
  );
});

test("external badges never turn discovered URLs into verified availability", () => {
  assert.equal(
    externalAccessLabel({ external_url: "", external_access: "unknown" }),
    "",
  );
  assert.equal(
    externalAccessLabel({
      external_url: "https://media.example",
      external_access: "unverified",
    }),
    "Внешний адрес найден · доступ извне не проверен · https://media.example",
  );
  assert.equal(
    externalAccessLabel({
      external_url: "https://media.example",
      external_access: "confirmed",
    }),
    "Доступно извне · https://media.example",
  );
});

test("search uses application names and keeps the flat list order", () => {
  const apps = [
    { id: "1", name: "Медиатека Plex", group_id: "media" },
    { id: "2", name: "Gitea", group_id: null },
    { id: "3", name: "Sonarr", group_id: "media" },
  ];
  assert.deepEqual(
    filterApplications(apps, " МЕДИА ").map((a) => a.id),
    ["1"],
  );
  assert.deepEqual(
    filterApplications(apps, "gitea").map((a) => a.id),
    ["2"],
  );
  assert.deepEqual(filterApplications(apps, "unknown"), []);
  assert.deepEqual(filterApplications(apps, ""), apps);
});

test("global ordering ignores legacy groups and does not mutate the catalogue", () => {
  const apps = [
    { id: "a", group_id: "old-group", position: 0, launchpad_position: 1 },
    { id: "b", group_id: null, position: 0, launchpad_position: 0 },
  ];
  assert.deepEqual(
    orderedApplications(apps).map((a) => a.id),
    ["b", "a"],
  );
  assert.deepEqual(
    apps.map((a) => a.id),
    ["a", "b"],
  );
});
