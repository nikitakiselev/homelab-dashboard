package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCPUTemperature(t *testing.T) {
	tests := []struct {
		name   string
		files  map[string]string
		want   *float64
		source string
	}{
		{"absent", nil, nil, ""},
		{"zenpower multisocket", map[string]string{
			"hwmon0/name": "zenpower", "hwmon0/temp1_label": "cpu0 Tdie", "hwmon0/temp1_input": "55000", "hwmon0/temp2_label": "cpu0 Tctl", "hwmon0/temp2_input": "85000",
			"hwmon1/name": "zenpower", "hwmon1/temp1_label": "cpu1 Tdie", "hwmon1/temp1_input": "60000", "hwmon1/temp2_label": "cpu1 Tctl", "hwmon1/temp2_input": "90000",
		}, ptr(60), "zenpower · Tdie"},
		{"unrelated", map[string]string{"hwmon0/name": "nvme", "hwmon0/temp1_input": "99000", "hwmon1/name": "acpitz", "hwmon1/temp1_input": "80000"}, nil, ""},
		{"package preferred", map[string]string{"hwmon7/name": "coretemp", "hwmon7/temp1_label": "Package id 0", "hwmon7/temp1_input": "46500", "hwmon7/temp2_label": "Core 0", "hwmon7/temp2_input": "60000"}, ptr(46.5), "coretemp · package"},
		{"core fallback", map[string]string{"hwmon2/name": "coretemp", "hwmon2/temp2_label": "Core 0", "hwmon2/temp2_input": "45000", "hwmon2/temp3_label": "Core 1", "hwmon2/temp3_input": "49000"}, ptr(49), "coretemp · max core"},
		{"amd die preferred", map[string]string{"hwmon0/name": "k10temp", "hwmon0/temp1_label": "Tctl", "hwmon0/temp1_input": "75000", "hwmon0/temp2_label": "Tdie", "hwmon0/temp2_input": "55000"}, ptr(55), "k10temp · Tdie"},
		{"amd control", map[string]string{"hwmon0/name": "zenpower", "hwmon0/temp1_label": "Tctl", "hwmon0/temp1_input": "75000"}, ptr(75), "zenpower · Tctl (control)"},
		{"maximum package", map[string]string{"hwmon0/name": "coretemp", "hwmon0/temp1_label": "Package id 0", "hwmon0/temp1_input": "45000", "hwmon9/name": "coretemp", "hwmon9/temp1_label": "Package id 1", "hwmon9/temp1_input": "51000"}, ptr(51), "coretemp · package"},
		{"faulted package falls back", map[string]string{"hwmon0/name": "coretemp", "hwmon0/temp1_label": "Package id 0", "hwmon0/temp1_input": "50000", "hwmon0/temp1_fault": "1", "hwmon0/temp2_label": "Core 0", "hwmon0/temp2_input": "44000"}, ptr(44), "coretemp · max core"},
		{"missing label", map[string]string{"hwmon0/name": "coretemp", "hwmon0/temp1_input": "50000"}, nil, ""},
		{"zero", map[string]string{"hwmon0/name": "coretemp", "hwmon0/temp1_label": "Package id 0", "hwmon0/temp1_input": "0"}, ptr(0), "coretemp · package"},
	}
	for _, bad := range []string{"", "oops", "NaN", "Inf", "150001", "-50001", "42.5"} {
		tests = append(tests, struct {
			name   string
			files  map[string]string
			want   *float64
			source string
		}{"invalid " + bad, map[string]string{"hwmon0/name": "coretemp", "hwmon0/temp1_label": "Package id 0", "hwmon0/temp1_input": bad}, nil, ""})
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			for name, value := range tt.files {
				path := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(value), 0644); err != nil {
					t.Fatal(err)
				}
			}
			got, source := readCPUTemperature(root)
			if (got == nil) != (tt.want == nil) || (got != nil && *got != *tt.want) || source != tt.source {
				t.Fatalf("got %v (%s), want %v (%s)", got, source, tt.want, tt.source)
			}
			// No stale reading survives a removed sysfs device.
			for name := range tt.files {
				if err := os.Remove(filepath.Join(root, name)); err != nil {
					t.Fatal(err)
				}
			}
			if got, source = readCPUTemperature(root); got != nil || source != "" {
				t.Fatal("retained disappeared sensor")
			}
		})
	}
}
