import assert from "node:assert/strict";
import test from "node:test";
import {
  recognizeApplication,
  externalAccessLabel,
  filterApplications,
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

test("search finds Russian group names, keeps order and handles empty results", () => {
  const groups = [{ id: "media", name: "Медиа", position: 0 }];
  const apps = [
    { id: "1", name: "Plex", group_id: "media" },
    { id: "2", name: "Gitea", group_id: null },
    { id: "3", name: "Sonarr", group_id: "media" },
  ];
  assert.deepEqual(
    filterApplications(apps, groups, " МЕДИА ").map((a) => a.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filterApplications(apps, groups, "gitea").map((a) => a.id),
    ["2"],
  );
  assert.deepEqual(filterApplications(apps, groups, "unknown"), []);
  assert.deepEqual(filterApplications(apps, groups, ""), apps);
});
