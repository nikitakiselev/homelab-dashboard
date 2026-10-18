package agent

import (
	"encoding/json"
	"testing"
)

func TestDiskClassification(t *testing.T) {
	for _, tc := range []struct{ name, model, transport, rota, want string }{
		{"sdd", "File-Stor Gadget", "usb", "true", "USB Gadget"},
		{"sdd", " File-Stor Gadget ", "usb", "false", "USB Gadget"},
		{"sdd", "Mass Storage Gadget", "usb", "null", "USB Gadget"},
		{"sdd", "External disk", "usb", "true", "USB"},
		{"sdd", "Flash drive", "usb", "false", "USB"},
		{"sdd", "Unknown USB", "usb", "null", "USB"},
		{"sda", "Disk", "sata", "true", "HDD"},
		{"sda", "Disk", "sata", `"1"`, "HDD"},
		{"sda", "Disk", "sata", "false", "SSD"},
		{"sda", "Disk", "sata", `"0"`, "SSD"},
		{"sda", "Disk", "sata", "null", "Unknown"},
		{"sda", "Disk", "", "", "Unknown"},
		{"nvme0n1", "Disk", "nvme", "null", "NVMe"},
	} {
		t.Run(tc.model+"/"+tc.transport+"/"+tc.rota, func(t *testing.T) {
			if got := classifyDisk(tc.name, tc.model, tc.transport, json.RawMessage(tc.rota)); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
