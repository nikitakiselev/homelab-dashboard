package agent

import (
	"encoding/json"
	"strings"
)

func classifyDisk(name, model, transport string, rota json.RawMessage) string {
	if transport == "usb" {
		// Linux USB mass-storage gadgets may advertise ROTA=true even when
		// backed by a file. Neither ROTA nor removability identifies the medium.
		switch strings.ToLower(strings.TrimSpace(model)) {
		case "file-stor gadget", "mass storage gadget":
			return "USB Gadget"
		}
		return "USB"
	}
	if strings.HasPrefix(name, "nvme") {
		return "NVMe"
	}
	switch string(rota) {
	case "false", "0", `"0"`:
		return "SSD"
	case "true", "1", `"1"`:
		return "HDD"
	default:
		return "Unknown"
	}
}
