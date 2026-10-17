//go:build linux

package agent

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func smartTestDisk() Disk {
	return Disk{Name: "sdb", Serial: "TEST-1", Model: "Test HDD", Total: 1000, Type: "HDD", Interface: "sata", Health: "unknown"}
}
func smartTestConfig() SMARTConfig {
	return SMARTConfig{Enabled: true, Interval: 86400, Serials: []string{"TEST-1"}}
}

const smartTestJSON = `{"serial_number":"TEST-1","smart_status":{"passed":true},"temperature":{"current":32},"ata_smart_attributes":{"table":[{"id":4,"raw":{"value":100}},{"id":193,"raw":{"value":200}}]}}`

func testSMARTStore(t *testing.T) (*History, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.sqlite")
	h, err := OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	return h, path
}
func TestScheduledSMARTBudgetCacheAndRestart(t *testing.T) {
	h, path := testSMARTStore(t)
	now := time.Unix(1700000000, 0)
	var calls [][]string
	run := func(ctx context.Context, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		if args[0] == "hdparm" {
			return []byte("/dev/sdb:\n drive state is: active/idle\n"), nil
		}
		return []byte(smartTestJSON), fmt.Errorf("health warning exit code")
	}
	disks := []Disk{smartTestDisk()}
	collect := func(at time.Time, activity time.Time) {
		t.Helper()
		if err := collectScheduledSMART(context.Background(), disks, map[string]time.Time{"sdb": activity}, at, smartTestConfig(), h, run); err != nil {
			t.Fatal(err)
		}
	}
	for _, at := range []time.Time{{}, now.Add(-16 * time.Second), now.Add(time.Second)} {
		collect(now, at)
	}
	if len(calls) != 0 {
		t.Fatal(calls)
	}
	collect(now, now)
	expected := [][]string{{"hdparm", "-C", "/dev/sdb"}, {"smartctl", "-i", "-H", "-A", "-j", "-d", "ata", "-n", "standby,75,76", "/dev/sdb"}}
	if !reflect.DeepEqual(calls, expected) {
		t.Fatal(calls)
	}
	if d := disks[0]; d.Health != "healthy" || *d.LoadCycleCount != 200 || *d.StartStopCount != 100 {
		t.Fatalf("%+v", d)
	}
	h.Close()
	var err error
	h, err = OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	for _, seconds := range []int64{60, 3600, 86399, -3600} {
		at := now.Add(time.Duration(seconds) * time.Second)
		disks = []Disk{smartTestDisk()}
		collect(at, at)
		if len(calls) != 2 || disks[0].Health != "healthy" || *disks[0].SMARTUpdatedAt != float64(now.Unix()) || disks[0].PowerState != "unknown" {
			t.Fatalf("cache/restart %+v calls %v", disks[0], calls)
		}
	}
	later := now.Add(48 * time.Hour)
	collect(later, time.Time{})
	if len(calls) != 2 {
		t.Fatal(calls)
	}
	collect(later, later)
	if len(calls) != 4 {
		t.Fatal(calls)
	}
}
func TestScheduledSMARTFailsClosedAndDoesNotRetry(t *testing.T) {
	for _, tc := range []struct {
		name, power, smart string
		powerErr           bool
		want               int
		state              string
	}{
		{"standby", "standby", "", false, 1, "sleeping"},
		{"sleeping", "sleeping", "", false, 1, "sleeping"},
		{"unknown", "unknown", "", false, 1, "power_unknown"},
		{"malformed", "", "", false, 1, "power_unknown"},
		{"command failure", "active/idle", "", true, 1, "power_unknown"},
		{"guarded race", "active/idle", `{"smartctl":{"exit_status":75}}`, false, 2, "sleeping"},
		{"unsupported", "active/idle", `{"smartctl":{"exit_status":76}}`, false, 2, "unsupported"},
		{"missing tool", "active/idle", "", false, 2, "unavailable"},
		{"replaced", "active/idle", `{"serial_number":"OTHER","smart_status":{"passed":true}}`, false, 2, "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, path := testSMARTStore(t)
			now := time.Unix(1700000000, 0)
			calls := 0
			run := func(ctx context.Context, args ...string) ([]byte, error) {
				calls++
				if args[0] == "hdparm" {
					if tc.powerErr {
						return nil, fmt.Errorf("missing tool")
					}
					return []byte(" drive state is: " + tc.power), nil
				}
				return []byte(tc.smart), fmt.Errorf("exit")
			}
			disks := []Disk{smartTestDisk()}
			_ = collectScheduledSMART(context.Background(), disks, map[string]time.Time{"sdb": now}, now, smartTestConfig(), h, run)
			if calls != tc.want || disks[0].SMARTState != tc.state {
				t.Fatalf("calls %d disk %+v", calls, disks[0])
			}
			h.Close()
			var err error
			h, err = OpenHistory(path, 90)
			if err != nil {
				t.Fatal(err)
			}
			defer h.Close()
			for range 65 {
				now = now.Add(time.Minute)
				_ = collectScheduledSMART(context.Background(), []Disk{smartTestDisk()}, map[string]time.Time{"sdb": now}, now, smartTestConfig(), h, run)
			}
			if calls != tc.want {
				t.Fatalf("retried %d", calls)
			}
		})
	}
}
func TestScheduledSMARTScopeAndDurableReservation(t *testing.T) {
	h, _ := testSMARTStore(t)
	defer h.Close()
	now := time.Unix(1700000000, 0)
	run := func(ctx context.Context, args ...string) ([]byte, error) {
		t.Fatalf("unexpected command %v", args)
		return nil, nil
	}
	for _, mode := range []string{"disabled", "usb", "sas", "unknown", "missing serial", "not allowed", "bad path", "NVMe", "no history"} {
		d := smartTestDisk()
		cfg := smartTestConfig()
		switch mode {
		case "disabled":
			cfg.Enabled = false
		case "usb", "sas":
			d.Interface = mode
		case "unknown":
			d.Interface = ""
		case "missing serial":
			d.Serial = ""
		case "not allowed":
			cfg.Serials = []string{"OTHER"}
		case "bad path":
			d.Name = "sdb/../sda"
		case "NVMe":
			d.Type = "NVMe"
		case "no history":
			_ = collectScheduledSMART(context.Background(), []Disk{d}, map[string]time.Time{d.Name: now}, now, cfg, nil, run)
			continue
		}
		if err := collectScheduledSMART(context.Background(), []Disk{d}, map[string]time.Time{d.Name: now}, now, cfg, h, run); err != nil {
			t.Fatal(err)
		}
	}
	record := smartRecord{AttemptAt: float64(now.Unix()), Outcome: "cooldown"}
	key := smartIdentity(smartTestDisk())
	ok, err := h.reserveSMART(key, record, record.AttemptAt-86400)
	if err != nil || !ok {
		t.Fatalf("%v %v", ok, err)
	}
	ok, err = h.reserveSMART(key, record, record.AttemptAt-86400)
	if err != nil || ok {
		t.Fatalf("duplicate reservation %v %v", ok, err)
	}
	// A crash after reservation still consumes the budget.
	if err := collectScheduledSMART(context.Background(), []Disk{smartTestDisk()}, map[string]time.Time{"sdb": now}, now, smartTestConfig(), h, run); err != nil {
		t.Fatal(err)
	}
	h.Close()
	later := now.Add(48 * time.Hour)
	if err := collectScheduledSMART(context.Background(), []Disk{smartTestDisk()}, map[string]time.Time{"sdb": later}, later, smartTestConfig(), h, run); err == nil {
		t.Fatal("closed database accepted")
	}
}
func TestScheduledSMARTCacheRejectsReplacement(t *testing.T) {
	h, _ := testSMARTStore(t)
	defer h.Close()
	now := time.Unix(1700000000, 0)
	old := smartTestDisk()
	record := smartRecord{AttemptAt: float64(now.Unix()), SampleAt: float64(now.Unix()), Raw: []byte(smartTestJSON), Outcome: "fresh"}
	if ok, err := h.reserveSMART(smartIdentity(old), record, 0); !ok || err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"serial", "model", "size", "disabled"} {
		d := old
		switch change {
		case "serial":
			d.Serial = "NEW"
		case "model":
			d.Model = "Other"
		case "size":
			d.Total++
		case "disabled":
			d.Name = "sdc"
		}
		run := func(ctx context.Context, args ...string) ([]byte, error) { t.Fatal(args); return nil, nil }
		disks := []Disk{d}
		if err := collectScheduledSMART(context.Background(), disks, nil, now, SMARTConfig{}, h, run); err != nil {
			t.Fatal(err)
		}
		if change == "disabled" {
			if disks[0].Health != "healthy" || disks[0].SMARTState != "passive" || *disks[0].SMARTUpdatedAt != record.SampleAt {
				t.Fatalf("lost cache %+v", disks[0])
			}
		} else if disks[0].SMARTUpdatedAt != nil {
			t.Fatalf("replacement %+v", disks[0])
		}
	}
}

func TestScheduledSMARTFailureRetainsWarningAndOriginalTimestamp(t *testing.T) {
	h, path := testSMARTStore(t)
	now := time.Unix(1700000000, 0)
	disks := []Disk{smartTestDisk()}
	run := func(ctx context.Context, args ...string) ([]byte, error) {
		if args[0] == "hdparm" {
			return []byte("drive state is: active/idle"), nil
		}
		return []byte(`{"serial_number":"TEST-1","smart_status":{"passed":false},"temperature":{"current":30},"ata_smart_attributes":{"table":[{"id":197,"raw":{"value":2}}]}}`), nil
	}
	if err := collectScheduledSMART(context.Background(), disks, map[string]time.Time{"sdb": now}, now, smartTestConfig(), h, run); err != nil {
		t.Fatal(err)
	}
	original := *disks[0].SMARTUpdatedAt
	now = now.Add(48 * time.Hour)
	failed := func(ctx context.Context, args ...string) ([]byte, error) {
		if args[0] == "hdparm" {
			return []byte("drive state is: active/idle"), nil
		}
		return nil, fmt.Errorf("unavailable")
	}
	if err := collectScheduledSMART(context.Background(), disks, map[string]time.Time{"sdb": now}, now, smartTestConfig(), h, failed); err == nil {
		t.Fatal("expected read error")
	}
	h.Close()
	var err error
	h, err = OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	disks = []Disk{smartTestDisk()}
	noCommands := func(ctx context.Context, args ...string) ([]byte, error) { t.Fatal(args); return nil, nil }
	if err := collectScheduledSMART(context.Background(), disks, nil, now, SMARTConfig{}, h, noCommands); err != nil {
		t.Fatal(err)
	}
	d := disks[0]
	if d.Health != "failed" || d.Warning == nil || *d.PendingSectors != 2 || *d.Temperature != 30 || *d.SMARTUpdatedAt != original || *d.SMARTAttemptAt != float64(now.Unix()) {
		t.Fatalf("lost old warning/sample %+v", d)
	}
}
