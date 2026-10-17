//go:build linux

package agent

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func powerTestRunner(t *testing.T, serial, transport, mode string, fail bool, calls *[][]string) func(context.Context, ...string) ([]byte, error) {
	t.Helper()
	return func(_ context.Context, args ...string) ([]byte, error) {
		*calls = append(*calls, append([]string(nil), args...))
		if args[0] == "lsblk" {
			return []byte(fmt.Sprintf(`{"blockdevices":[{"name":"sdb","serial":%q,"model":"Test HDD","size":1000,"tran":%q,"rota":true}]}`, serial, transport)), nil
		}
		if !reflect.DeepEqual(args, []string{"hdparm", "-C", "/dev/sdb"}) {
			t.Fatalf("unexpected device command %v", args)
		}
		if fail {
			return nil, fmt.Errorf("failed")
		}
		return []byte("drive state is: " + mode), nil
	}
}

func TestDiskPowerIsScheduledMetricWithDurableBudget(t *testing.T) {
	h, path := testSMARTStore(t)
	cfg := DefaultConfig().Collection.Disks
	now := time.Unix(1700000000, 0)
	disks := []Disk{smartTestDisk()}
	var calls [][]string
	run := powerTestRunner(t, "TEST-1", "sata", "standby", false, &calls)
	if err := collectDiskPower(context.Background(), disks, now, cfg, h, run); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 {
		t.Fatal(calls)
	}
	h.Close()
	h, err := OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	disk := smartTestDisk()
	disk.Name = "sdz"
	if err := loadDiskPowerObservation(&disk, h, now.Add(time.Second), cfg); err != nil {
		t.Fatal(err)
	}
	if disk.PowerState != "standby" || disk.PowerCheckedAt == nil || *disk.PowerCheckedAt != float64(now.Unix()) {
		t.Fatalf("metric lost on restart/rename: %+v", disk)
	}
	for _, offset := range []time.Duration{time.Second, 59 * time.Second, -time.Hour} {
		if err := collectDiskPower(context.Background(), disks, now.Add(offset), cfg, h, run); err != nil {
			t.Fatal(err)
		}
	}
	if len(calls) != 2 {
		t.Fatal("restart or early tick repeated commands", calls)
	}
	run = powerTestRunner(t, "TEST-1", "sata", "active/idle", false, &calls)
	if err := collectDiskPower(context.Background(), disks, now.Add(60*time.Second), cfg, h, run); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 4 {
		t.Fatal(calls)
	}
	if err := loadDiskPowerObservation(&disk, h, now.Add(61*time.Second), cfg); err != nil {
		t.Fatal(err)
	}
	if disk.PowerState != "active" {
		t.Fatal(disk)
	}
	if err := loadDiskPowerObservation(&disk, h, now.Add(181*time.Second), cfg); err != nil {
		t.Fatal(err)
	}
	if disk.PowerState != "unknown" {
		t.Fatal("stale sample shown as current", disk)
	}
	disk.Serial = "REPLACEMENT"
	if err := loadDiskPowerObservation(&disk, h, now.Add(61*time.Second), cfg); err != nil {
		t.Fatal(err)
	}
	if disk.PowerState != "unknown" || disk.PowerCheckedAt != nil {
		t.Fatal("replacement inherited power sample")
	}
}

func TestDiskPowerFailsClosedAndPublishesErrors(t *testing.T) {
	for _, tc := range []struct {
		name, serial, transport, mode, state string
		fail, wantErr                        bool
		commands                             int
	}{
		{"standby", "TEST-1", "sata", "standby", "standby", false, false, 2},
		{"sleep", "TEST-1", "sata", "sleeping", "sleep", false, false, 2},
		{"active", "TEST-1", "sata", "active/idle", "active", false, false, 2},
		{"unknown", "TEST-1", "sata", "unrecognized", "unknown", false, false, 2},
		{"error", "TEST-1", "sata", "standby", "unknown", true, true, 2},
		{"replacement", "OTHER", "sata", "standby", "unknown", false, true, 1},
		{"bridge changed", "TEST-1", "usb", "standby", "unknown", false, true, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, _ := testSMARTStore(t)
			defer h.Close()
			now := time.Unix(1700000000, 0)
			cfg := DefaultConfig().Collection.Disks
			var calls [][]string
			run := powerTestRunner(t, tc.serial, tc.transport, tc.mode, tc.fail, &calls)
			disk := smartTestDisk()
			err := collectDiskPower(context.Background(), []Disk{disk}, now, cfg, h, run)
			if (err != nil) != tc.wantErr || len(calls) != tc.commands {
				t.Fatalf("%v %v", err, calls)
			}
			if err := loadDiskPowerObservation(&disk, h, now, cfg); err != nil {
				t.Fatal(err)
			}
			if disk.PowerState != tc.state || (disk.PowerError != "") != tc.wantErr {
				t.Fatalf("incorrect metric %+v", disk)
			}
			_ = collectDiskPower(context.Background(), []Disk{disk}, now.Add(10*time.Second), cfg, h, run)
			if len(calls) != tc.commands {
				t.Fatal("error retried before budget elapsed")
			}
		})
	}
}

func TestDiskPowerScopeDisableAndMinimumInterval(t *testing.T) {
	cfg := DefaultConfig().Collection.Disks
	h, _ := testSMARTStore(t)
	defer h.Close()
	run := func(context.Context, ...string) ([]byte, error) { t.Fatal("command outside scope"); return nil, nil }
	for _, change := range []func(*Disk){
		func(d *Disk) { d.Interface = "usb" }, func(d *Disk) { d.Interface = "sas" },
		func(d *Disk) { d.Type = "SSD" }, func(d *Disk) { d.Type = "NVMe" },
		func(d *Disk) { d.Serial = "" }, func(d *Disk) { d.Total = 0 },
		func(d *Disk) { d.Name = "sdb/../../other" },
	} {
		disk := smartTestDisk()
		change(&disk)
		if err := collectDiskPower(context.Background(), []Disk{disk}, time.Now(), cfg, h, run); err != nil {
			t.Fatal(err)
		}
	}
	for _, disabled := range []DiskConfig{{Enabled: false, PowerState: true, Interval: 60}, {Enabled: true, PowerState: false, Interval: 60}} {
		if err := collectDiskPower(context.Background(), []Disk{smartTestDisk()}, time.Now(), disabled, h, run); err != nil {
			t.Fatal(err)
		}
	}
	cfg.Interval = 1
	now := time.Unix(1700000000, 0)
	var calls [][]string
	supported := powerTestRunner(t, "TEST-1", "sata", "standby", false, &calls)
	for _, offset := range []int{0, 1, 20, 59} {
		if err := collectDiskPower(context.Background(), []Disk{smartTestDisk()}, now.Add(time.Duration(offset)*time.Second), cfg, h, supported); err != nil {
			t.Fatal(err)
		}
	}
	if len(calls) != 2 {
		t.Fatal("short metadata interval exceeded power budget", calls)
	}
}
