//go:build linux

package agent

import (
	"context"
	"fmt"
	"reflect"
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

func TestSleepingAndUnsafeDisksSkipFilesystemIO(t *testing.T) {
	// A real mount makes stat/statfs observable: refreshing it would replace the
	// cached volume and timestamp.
	for _, transport := range []string{"sata", "usb", "sas", ""} {
		calls := 0
		run := func(ctx context.Context, args ...string) ([]byte, error) {
			calls++
			if args[0] == "lsblk" {
				return []byte(fmt.Sprintf(`{"blockdevices":[{"name":"sdb","type":"disk","size":1000,"model":"Test","serial":"DISK-1","rota":true,"tran":%q,"mountpoints":["/"]}]}`, transport)), nil
			}
			want := []string{"smartctl", "-a", "-j", "-d", "ata", "-n", "standby,75,76", "/dev/sdb"}
			if !reflect.DeepEqual(args, want) {
				t.Fatalf("unsafe command: %v", args)
			}
			return []byte(`{"smartctl":{"exit_status":75}}`), fmt.Errorf("exit status 75")
		}
		old := Disk{Name: "sda", Model: "Test", Serial: "DISK-1", Type: "HDD", Total: 1000, Used: 600, Health: "warning", Temperature: ptr(32), SMARTUpdatedAt: ptr(100), UsageUpdatedAt: ptr(100), Volumes: []Volume{{"/cached", 1000, 600}}}
		result, err := readDisks(context.Background(), []Disk{old}, run)
		if err != nil || len(result) != 1 {
			t.Fatalf("%v: %v", result, err)
		}
		d := result[0]
		if d.Used != 600 || *d.UsageUpdatedAt != 100 || len(d.Volumes) != 1 || d.Volumes[0].Mount != "/cached" {
			t.Fatalf("filesystem was refreshed: %+v", d)
		}
		if d.Name != "sdb" || d.Health != "warning" || *d.Temperature != 32 {
			t.Fatalf("cache: %+v", d)
		}
		if transport == "sata" {
			if calls != 2 || d.SMARTState != "sleeping" {
				t.Fatalf("SATA: %+v, %d calls", d, calls)
			}
		} else if calls != 1 || d.SMARTState != "skipped" {
			t.Fatalf("unsafe transport: %+v, %d calls", d, calls)
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
