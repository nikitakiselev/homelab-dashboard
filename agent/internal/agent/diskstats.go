package agent

import (
	"strconv"
	"strings"
)

// DiskIO contains deltas for one observed interval, never lifetime counters.
// Seconds allows rates to be weighted by actual observed time during aggregation.
type DiskIO struct {
	ReadBytes  float64 `json:"read_bytes"`
	WriteBytes float64 `json:"write_bytes"`
	ReadOps    float64 `json:"read_ops"`
	WriteOps   float64 `json:"write_ops"`
	Seconds    float64 `json:"seconds"`
}
type diskCounters struct {
	identity string
	values   [4]uint64
}

func parseDiskstats(raw string, wholeDevice func(string) bool) map[string]diskCounters {
	out := map[string]diskCounters{}
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 14 || !wholeDevice(f[2]) {
			continue
		}
		row := diskCounters{identity: f[0] + ":" + f[1]}
		valid := true
		for i, index := range []int{5, 9, 3, 7} {
			value, err := strconv.ParseUint(f[index], 10, 64)
			if err != nil {
				valid = false
				break
			}
			row.values[i] = value
		}
		if valid {
			out[f[2]] = row
		}
	}
	return out
}
func diskDeltas(current, previous map[string]diskCounters, seconds float64) map[string]DiskIO {
	out := map[string]DiskIO{}
	if seconds <= 0 {
		return out
	}
	for name, row := range current {
		old, ok := previous[name]
		if !ok || old.identity != row.identity {
			continue
		}
		valid := true
		for i, value := range row.values {
			if value < old.values[i] {
				valid = false
			}
		}
		if !valid {
			continue
		} // Reset or replacement: establish a fresh baseline.
		out[name] = DiskIO{float64(row.values[0]-old.values[0]) * 512, float64(row.values[1]-old.values[1]) * 512,
			float64(row.values[2] - old.values[2]), float64(row.values[3] - old.values[3]), seconds}
	}
	return out
}
func addDiskIO(target map[string]DiskIO, source map[string]DiskIO) {
	for name, v := range source {
		old := target[name]
		target[name] = DiskIO{old.ReadBytes + v.ReadBytes, old.WriteBytes + v.WriteBytes, old.ReadOps + v.ReadOps, old.WriteOps + v.WriteOps, old.Seconds + v.Seconds}
	}
}
