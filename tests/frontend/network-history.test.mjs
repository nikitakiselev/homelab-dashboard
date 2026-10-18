import assert from "node:assert/strict";
import test from "node:test";
import {
  networkHistoryRows,
  toggleNetworkHost,
} from "../../frontend/src/components/network-history-data.ts";

test("combines hosts without converting missing measurements to zero", () => {
  assert.deepEqual(
    networkHistoryRows(
      {
        a: [{ bucket: 0, rx: 0, tx: null }],
        b: [{ bucket: 300, rx: 12, tx: 8 }],
      },
      ["a", "b"],
      300,
    ),
    [
      { bucket: 0, rx0: 0, tx0: null, rx1: null, tx1: null },
      { bucket: 300, rx0: null, tx0: null, rx1: 12, tx1: 8 },
    ],
  );
});
test("adds null measurements to break gaps even when all hosts are missing", () => {
  const rows = networkHistoryRows(
    {
      a: [
        { bucket: 900, rx: 4, tx: 5 },
        { bucket: 0, rx: 1, tx: 2 },
      ],
    },
    ["a"],
    300,
  );
  assert.deepEqual(
    rows.map((row) => row.bucket),
    [0, 300, 900],
  );
  assert.equal(rows[1].rx0, null);
  assert.equal(rows[1].tx0, null);
});
test("keeps a failed or empty host unavailable", () => {
  assert.deepEqual(
    networkHistoryRows(
      { a: [{ bucket: 0, rx: 4, tx: 5 }] },
      ["a", "missing"],
      21600,
    )[0],
    { bucket: 0, rx0: 4, tx0: 5, rx1: null, tx1: null },
  );
  assert.deepEqual(networkHistoryRows({}, [], 300), []);
});
test("click isolates a host and a second click restores all hosts", () => {
  assert.deepEqual(toggleNetworkHost(["a", "b"], null, "a", false), ["a"]);
  assert.equal(toggleNetworkHost(["a", "b"], ["a"], "a", false), null);
  assert.deepEqual(toggleNetworkHost(["a", "b"], ["a"], "b", false), ["b"]);
});
test("modifier click allows multiple hosts and never leaves an empty chart", () => {
  assert.deepEqual(toggleNetworkHost(["a", "b", "c"], null, "b", true), [
    "a",
    "c",
  ]);
  assert.deepEqual(toggleNetworkHost(["a", "b", "c"], ["a"], "b", true), [
    "a",
    "b",
  ]);
  assert.equal(toggleNetworkHost(["a", "b"], ["a"], "b", true), null);
  assert.equal(toggleNetworkHost(["a", "b"], ["a"], "a", true), null);
});
test("selection falls back to all hosts after a selected host is removed", () => {
  assert.deepEqual(toggleNetworkHost(["a", "b"], ["removed"], "a", true), [
    "b",
  ]);
});
