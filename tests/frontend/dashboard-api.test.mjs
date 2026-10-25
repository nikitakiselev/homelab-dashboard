import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardResponse } from "../../frontend/src/dashboard-api.ts";

test("successful catalogue login clears the prompt even while metrics fail", async () => {
  let needsAuthentication = false;
  const setAuthentication = (required) => {
    needsAuthentication = required;
  };
  await assert.rejects(() =>
    readDashboardResponse(
      Response.json({ error: "login" }, { status: 401 }),
      setAuthentication,
    ),
  );
  assert.equal(needsAuthentication, true);
  await assert.rejects(
    () =>
      readDashboardResponse(
        Response.json({ error: "metrics unavailable" }, { status: 503 }),
        setAuthentication,
      ),
    /metrics unavailable/,
  );
  const catalogue = await readDashboardResponse(
    Response.json({ groups: [], applications: [] }),
    setAuthentication,
  );
  assert.deepEqual(catalogue, { groups: [], applications: [] });
  assert.equal(needsAuthentication, false);
  await assert.rejects(() =>
    readDashboardResponse(
      Response.json({ error: "metrics still unavailable" }, { status: 503 }),
      setAuthentication,
    ),
  );
  assert.equal(needsAuthentication, false);
});
