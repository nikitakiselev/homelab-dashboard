package agent

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestDiskstatsDeltasAndBaselines(t *testing.T) {
	whole := func(name string) bool { return name == "sda" }
	parse := func(line string) map[string]diskCounters { return parseDiskstats(line, whole) }
	before := parse("8 0 sda 10 0 100 0 20 0 200 0 0 0 0\n8 1 sda1 10 0 100 0 20 0 200 0 0 0 0\ninvalid")
	after := parse("8 0 sda 12 0 110 0 23 0 220 0 0 0 0 0 0 0 0 0 0")
	if len(before) != 1 {
		t.Fatalf("partitions/malformed rows included: %+v", before)
	}
	if len(diskDeltas(before, nil, 5)) != 0 {
		t.Fatal("first snapshot counted lifetime totals")
	}
	io := diskDeltas(after, before, 5)["sda"]
	if io != (DiskIO{5120, 10240, 2, 3, 5}) {
		t.Fatalf("wrong sector units or offsets: %+v", io)
	}
	if v := diskDeltas(after, after, 5)["sda"]; v != (DiskIO{Seconds: 5}) {
		t.Fatalf("idle must be measured zero: %+v", v)
	}
	for _, current := range []map[string]diskCounters{
		before, // counter reset
		parse("8 16 sda 12 0 110 0 23 0 220 0 0 0 0"), // device identity changed
		parse("8 0 sda 12 0 broken 0 23 0 220 0 0 0 0"),
	} {
		if len(diskDeltas(current, after, 5)) != 0 {
			t.Fatalf("invalid interval counted: %+v", current)
		}
	}
	if len(diskDeltas(after, before, 0)) != 0 {
		t.Fatal("nonpositive time counted")
	}
	if len(diskDeltas(after, parse(""), 5)) != 0 {
		t.Fatal("reappearance counted lifetime totals")
	}
}

func TestDiskHistoryUpgradeAggregationAndRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.sqlite")
	// Existing databases retain their original schema and CPU/network history.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE history (host TEXT,bucket INTEGER,cpu REAL,memory REAL,gpu REAL,rx REAL,tx REAL,rx_bytes REAL,tx_bytes REAL,samples INTEGER,PRIMARY KEY(host,bucket))`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	h, err := OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	stamp := float64(time.Now().Unix()/300*300 + 1)
	m := Metrics{Timestamp: stamp, AgentID: "fixture", CPU: CPU{Usage: ptr(10)}, DiskIO: map[string]DiskIO{"sda": {5120, 10240, 2, 3, 5}}}
	for range 2 {
		if err = h.Sample(m, 0, 0); err != nil {
			t.Fatal(err)
		}
	}
	h.Close()
	h, err = OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	rows, err := h.Read("fixture", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("unexpected rows: %+v", rows)
	}
	if io := rows[0]["disk_io"].(map[string]DiskIO)["sda"]; io != (DiskIO{10240, 20480, 4, 6, 10}) {
		t.Fatalf("incorrect persisted disk totals: %+v", io)
	}
	m.Timestamp = stamp - 91*86400
	if err = h.Sample(m, 0, 0); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = h.db.QueryRow("SELECT count(*) FROM disk_history").Scan(&count); err != nil || count != 1 {
		t.Fatalf("retention: %d %v", count, err)
	}
}

func TestDiskHistoryPagesAreBounded(t *testing.T) {
	h, err := OpenHistory(filepath.Join(t.TempDir(), "test.sqlite"), 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	disks := map[string]DiskIO{}
	for i := 0; i < 1000; i++ {
		disks[fmt.Sprintf("disk-%d", i)] = DiskIO{5120, 10240, 2, 3, 5}
	}
	payload, _ := json.Marshal(disks)
	bucket := time.Now().Unix()/300*300 - 3000
	for i := 0; i < 15; i++ {
		stamp := bucket + int64(i)*300
		if _, err = h.db.Exec("INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?)", "fixture", stamp, 0, 0, nil, 0, 0, 0, 0, 1); err != nil {
			t.Fatal(err)
		}
		if _, err = h.db.Exec("INSERT INTO disk_history VALUES (?,?,?)", "fixture", stamp, string(payload)); err != nil {
			t.Fatal(err)
		}
	}
	first, err := h.Read("fixture", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) == 0 || len(first) >= 15 {
		t.Fatalf("page was not bounded: %d", len(first))
	}
	encoded, _ := json.Marshal(first)
	if len(encoded) > 1_010_000 {
		t.Fatalf("page too large: %d", len(encoded))
	}
	last := first[len(first)-1]["bucket"].(int64)
	more, err := h.hasMore("fixture", last)
	if err != nil || !more {
		t.Fatalf("continuation missing: %v %v", more, err)
	}
	second, err := h.Read("fixture", last+1)
	if err != nil || len(second) == 0 || second[0]["bucket"].(int64) <= last {
		t.Fatalf("page did not advance: %v", err)
	}
}
