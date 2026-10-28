package agent

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// readCPUTemperature reads CPU-only hwmon attributes. It never runs a command
// or uses generic thermal zones, which may describe unrelated hardware.
func readCPUTemperature(root string) (*float64, string) {
	text := func(path string) string {
		raw, _ := os.ReadFile(path)
		return strings.TrimSpace(string(raw))
	}
	devices, _ := filepath.Glob(filepath.Join(root, "hwmon*"))
	var hottest *float64
	source := ""
	for _, device := range devices {
		driver := text(filepath.Join(device, "name"))
		if driver != "coretemp" && driver != "k10temp" && driver != "zenpower" {
			continue
		}
		var selected *float64
		selectedRank := 0
		selectedSource := ""
		inputs, _ := filepath.Glob(filepath.Join(device, "temp*_input"))
		for _, input := range inputs {
			base := strings.TrimSuffix(input, "_input")
			label := text(base + "_label")
			// Upstream zenpower prefixes labels on multi-socket systems.
			if driver == "zenpower" {
				label = strings.TrimPrefix(strings.TrimPrefix(label, "cpu0 "), "cpu1 ")
			}
			rank, description := 0, ""
			if driver == "coretemp" {
				if strings.HasPrefix(label, "Package id ") {
					rank, description = 2, "package"
				} else if strings.HasPrefix(label, "Core ") {
					rank, description = 1, "max core"
				}
			} else if label == "Tdie" {
				rank, description = 2, "Tdie"
			} else if label == "Tctl" {
				rank, description = 1, "Tctl (control)"
			}
			if rank == 0 {
				continue
			}
			// Missing fault attributes are normal; unreadable existing ones fail closed.
			fault, err := os.ReadFile(base + "_fault")
			if (err != nil && !os.IsNotExist(err)) || (err == nil && strings.TrimSpace(string(fault)) != "0") {
				continue
			}
			milli, err := strconv.ParseInt(text(input), 10, 64)
			if err != nil || milli < -50000 || milli > 150000 {
				continue
			}
			value := float64(milli) / 1000
			if rank > selectedRank || (rank == selectedRank && (selected == nil || value > *selected)) {
				selected, selectedRank, selectedSource = &value, rank, driver+" · "+description
			}
		}
		if selected != nil && (hottest == nil || *selected > *hottest) {
			hottest, source = selected, selectedSource
		}
	}
	return hottest, source
}
