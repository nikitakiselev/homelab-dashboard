//go:build linux

package agent

import (
	"context"
	"fmt"
	"testing"
)

func TestSMARTWarningsAndUnknownData(t *testing.T) {
	for _, test := range []struct{ raw, health string }{
		{`{}`, "unknown"},
		{`{"smart_status":{"passed":true}}`, "healthy"},
		{`{"smart_status":{"passed":false},"nvme_smart_health_information_log":{"critical_warning":1}}`, "failed"},
		{`{"smart_status":{"passed":true},"nvme_smart_health_information_log":{"percentage_used":100}}`, "warning"},
		{`{"smart_status":{"passed":true},"ata_smart_attributes":{"table":[{"id":197,"raw":{"value":2}}]}}`, "warning"},
	} {
		d := Disk{Health: "unknown"}
		applySMART(&d, []byte(test.raw))
		if d.Health != test.health {
			t.Fatalf("%s got %s", test.raw, d.Health)
		}
	}
}

func TestSMARTSleepAndErrorsRetainLastSample(t *testing.T) {
	for _, tc := range []struct{ raw, state, power string }{
		{`{"smartctl":{"exit_status":75},"power_mode":{"name":"STANDBY"}}`, "sleeping", "standby"},
		{`{"smartctl":{"exit_status":75},"power_mode":{"name":"SLEEP"}}`, "sleeping", "sleep"},
		{`{"smartctl":{"exit_status":76}}`, "unsupported", "unknown"},
		{`{"smartctl":{"exit_status":2}}`, "unavailable", "unknown"},
		{`{}`, "unavailable", "unknown"},
		{`invalid`, "unavailable", "unknown"},
	} {
		d := Disk{Health: "unknown"}
		applySMART(&d, []byte(`{"smart_status":{"passed":false},"temperature":{"current":32},"power_on_time":{"hours":1200}}`))
		updated := *d.SMARTUpdatedAt
		applySMART(&d, []byte(tc.raw))
		if d.SMARTState != tc.state || d.PowerState != tc.power || d.Health != "failed" || *d.Temperature != 32 || *d.SMARTUpdatedAt != updated {
			t.Fatalf("%s: %+v", tc.raw, d)
		}
		applySMART(&d, []byte(`{"smart_status":{"passed":true},"temperature":{"current":35}}`))
		if d.SMARTState != "fresh" || d.PowerState != "active" || d.Health != "healthy" || *d.Temperature != 35 {
			t.Fatalf("wake: %+v", d)
		}
	}
}

func TestSMARTDetailsIncludeZeroValues(t *testing.T) {
	d := Disk{}
	applySMART(&d, []byte(`{"smart_status":{"passed":true},"serial_number":"NVME-1","firmware_version":"1.2","power_on_time":{"hours":0},"power_cycle_count":0,"nvme_smart_health_information_log":{"percentage_used":0,"available_spare":100,"media_errors":0}}`))
	if d.Serial != "NVME-1" || d.Firmware != "1.2" || d.PowerOnHours == nil || *d.PowerOnHours != 0 || d.PercentageUsed == nil || *d.PercentageUsed != 0 || d.MediaErrors == nil || *d.MediaErrors != 0 || d.PendingSectors != nil {
		t.Fatalf("details: %+v", d)
	}
}

func TestATADisksNeverReceiveCommandsOrFilesystemProbes(t *testing.T) {
	for _, transport := range []string{"sata", "ata", "usb", "sas", ""} {
		for _, power := range []string{"active", "standby", "unknown"} {
			calls := 0
			run := func(ctx context.Context, args ...string) ([]byte, error) {
				calls++
				if args[0] != "lsblk" {
					t.Fatalf("device command in passive collection: %v", args)
				}
				return []byte(fmt.Sprintf(`{"blockdevices":[{"name":"sdb","type":"disk","size":1000,"model":"Test","serial":"DISK-1","rota":true,"tran":%q,"mountpoints":["/"]}]}`, transport)), nil
			}
			old := Disk{Name: "sda", Model: "Test", Serial: "DISK-1", Type: "HDD", Total: 1000, Used: 600, Health: "warning", Temperature: ptr(32), SMARTUpdatedAt: ptr(100), UsageUpdatedAt: ptr(100), PowerState: power, Volumes: []Volume{{"/cached", 1000, 600}}}
			previous := []Disk{old}
			for range 65 {
				result, err := readDisks(context.Background(), previous, run)
				if err != nil || len(result) != 1 {
					t.Fatalf("%v %v", result, err)
				}
				d := result[0]
				if d.SMARTState != "passive" || d.PowerState != "unknown" || d.Used != 600 || *d.UsageUpdatedAt != 100 || *d.SMARTUpdatedAt != 100 || len(d.Volumes) != 1 || d.Volumes[0].Mount != "/cached" || d.Health != "warning" || *d.Temperature != 32 {
					t.Fatalf("cached data changed: %+v", d)
				}
				previous = result
			}
			if calls != 65 {
				t.Fatalf("unexpected command count: %d", calls)
			}
		}
	}
}

func TestATACommandsDisabledEvenForSSD(t *testing.T) {
	for _, transport := range []string{"sata", "ata", "usb", "sas", ""} {
		if args := diskSMARTArgs("sda", transport); args != nil {
			t.Fatalf("ATA command generated: %v", args)
		}
	}
}

func TestReplacedDiskDoesNotInheritCache(t *testing.T) {
	for _, serial := range []string{"NEW", ""} {
		run := func(ctx context.Context, args ...string) ([]byte, error) {
			if args[0] == "lsblk" {
				return []byte(fmt.Sprintf(`{"blockdevices":[{"name":"sda","type":"disk","size":1000,"model":"Test","serial":%q,"rota":true,"tran":"sata","mountpoints":["/"]}]}`, serial)), nil
			}
			return []byte(`{"smartctl":{"exit_status":75}}`), nil
		}
		result, err := readDisks(context.Background(), []Disk{{Name: "sda", Model: "Test", Serial: "OLD", Type: "HDD", Total: 1000, Used: 999, Health: "failed"}}, run)
		if err != nil || len(result) != 1 {
			t.Fatalf("%v: %v", result, err)
		}
		d := result[0]
		if d.Health != "unknown" || d.Used != 0 || d.SMARTUpdatedAt != nil || d.UsageUpdatedAt != nil {
			t.Fatalf("old drive's data leaked: %+v", d)
		}
	}
}

func TestMixedOrUnknownStorageSkipsNVMeFilesystemProbes(t *testing.T) {
	for _, rota := range []string{"true", "null"} {
		run := func(ctx context.Context, args ...string) ([]byte, error) {
			if args[0] == "lsblk" {
				return []byte(fmt.Sprintf(`{"blockdevices":[{"name":"sda","type":"disk","size":1000,"rota":%s,"tran":"sata","mountpoints":["/"]},{"name":"nvme0n1","type":"disk","size":2000,"rota":false,"serial":"SSD-1","model":"SSD","mountpoints":["/"]}]}`, rota)), nil
			}
			if args[0] != "smartctl" || args[len(args)-1] != "/dev/nvme0n1" {
				t.Fatalf("unexpected command: %v", args)
			}
			return []byte(`{"smart_status":{"passed":true}}`), nil
		}
		old := Disk{Name: "nvme0n1", Model: "SSD", Serial: "SSD-1", Type: "NVMe", Total: 2000, Used: 100, UsageUpdatedAt: ptr(100), Volumes: []Volume{{"/cached", 2000, 100}}}
		found, err := readDisks(context.Background(), []Disk{old}, run)
		if err != nil || len(found) != 2 {
			t.Fatalf("%v %v", found, err)
		}
		if d := found[1]; d.Used != 100 || *d.UsageUpdatedAt != 100 || len(d.Volumes) != 1 || d.Volumes[0].Mount != "/cached" {
			t.Fatalf("filesystem probe on mixed storage: %+v", d)
		}
	}
}
