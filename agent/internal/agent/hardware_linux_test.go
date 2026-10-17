//go:build linux

package agent

import "testing"

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
