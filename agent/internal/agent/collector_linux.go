//go:build linux

package agent

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Collector struct {
	Config       Config
	History      *History
	ID           string
	mu           sync.RWMutex
	latest       *Metrics
	disks        []Disk
	gpus         []GPU
	diagnostics  map[string]string
	previousDisk map[string]diskCounters
	previousCPU  [2]float64
	previousNet  map[string][2]float64
	previousTime time.Time
}

func read(path string) string { raw, _ := os.ReadFile(path); return strings.TrimSpace(string(raw)) }
func number(s string) float64 { n, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return n }
func exists(path string) bool { _, err := os.Stat(path); return err == nil }
func NewCollector(c Config, h *History) (*Collector, error) {
	hostname, _ := os.Hostname()
	machine := read("/etc/machine-id")
	if machine == "" {
		machine = hostname
	}
	return &Collector{Config: c, History: h, ID: fmt.Sprintf("%x", sha256.Sum256([]byte(machine)))[:24], disks: []Disk{}, gpus: []GPU{}, diagnostics: map[string]string{}}, nil
}
func (c *Collector) Snapshot() *Metrics {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.latest == nil {
		return nil
	}
	m := *c.latest
	return &m
}
func (c *Collector) Run(ctx context.Context) {
	var workers sync.WaitGroup
	probe := func(kind string, interval float64, enabled bool) {
		if !enabled {
			return
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				if kind == "disks" {
					c.mu.RLock()
					previous := c.disks
					c.mu.RUnlock()
					v, err := readDisks(ctx, previous, command)
					c.mu.Lock()
					c.disks = v
					if err != nil {
						c.diagnostics[kind] = err.Error()
					} else {
						delete(c.diagnostics, kind)
					}
					c.mu.Unlock()
				} else {
					v, err := ReadGPUs(ctx)
					c.mu.Lock()
					c.gpus = v
					if err != nil {
						c.diagnostics[kind] = err.Error()
					} else {
						delete(c.diagnostics, kind)
					}
					c.mu.Unlock()
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Duration(interval * float64(time.Second))):
				}
			}
		}()
	}
	probe("disks", c.Config.Collection.Disks.Interval, c.Config.Collection.Disks.Enabled)
	probe("gpus", c.Config.Collection.GPU.Interval, c.Config.Collection.GPU.Enabled)
	defer workers.Wait()
	ticker := time.NewTicker(time.Duration(c.Config.Collection.Interval * float64(time.Second)))
	defer ticker.Stop()
	for {
		if err := c.Collect(); err != nil {
			log.Printf("collection: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (c *Collector) Collect() error {
	now := time.Now()
	hostname, _ := os.Hostname()
	stat := strings.Fields(strings.SplitN(read("/proc/stat"), "\n", 2)[0])
	if len(stat) < 9 {
		return fmt.Errorf("cannot read /proc/stat")
	}
	var total float64
	for _, v := range stat[1:9] {
		total += number(v)
	}
	idle := number(stat[4]) + number(stat[5])
	var usage *float64
	if c.previousCPU[0] > 0 {
		dt := total - c.previousCPU[0]
		v := 0.0
		if dt > 0 {
			v = 100 * (1 - (idle-c.previousCPU[1])/dt)
		}
		usage = ptr(math.Round(math.Max(0, math.Min(100, v))*10) / 10)
	}
	c.previousCPU = [2]float64{total, idle}
	mem := map[string]uint64{}
	for _, line := range strings.Split(read("/proc/meminfo"), "\n") {
		f := strings.Fields(line)
		if len(f) > 1 {
			mem[strings.TrimSuffix(f[0], ":")] = uint64(number(f[1])) * 1024
		}
	}
	mt := mem["MemTotal"]
	if mt == 0 {
		return fmt.Errorf("cannot read /proc/meminfo")
	}
	available, ok := mem["MemAvailable"]
	if !ok {
		available = mem["MemFree"]
	}
	if available > mt {
		available = mt
	}
	used := mt - available
	type nic struct {
		name     string
		rx, tx   float64
		physical bool
	}
	all := []nic{}
	for _, line := range strings.Split(read("/proc/net/dev"), "\n") {
		name, data, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "lo" {
			continue
		}
		f := strings.Fields(data)
		if len(f) >= 9 {
			all = append(all, nic{name, number(f[0]), number(f[8]), exists("/sys/class/net/" + name + "/device")})
		}
	}
	configured := c.Config.Network.Interfaces
	if value, ok := os.LookupEnv("HOMELAB_INTERFACES"); ok {
		configured = nil
		for _, n := range strings.Split(value, ",") {
			if n = strings.TrimSpace(n); n != "" {
				configured = append(configured, n)
			}
		}
	}
	selected := []nic{}
	wanted := map[string]bool{}
	for _, n := range configured {
		wanted[n] = true
	}
	for _, n := range all {
		if (len(configured) > 0 && wanted[n.name]) || (len(configured) == 0 && n.physical) {
			selected = append(selected, n)
		}
	}
	if len(selected) == 0 && len(configured) == 0 {
		for _, n := range all {
			skip := false
			for _, prefix := range []string{"veth", "docker", "br-", "virbr", "tap", "fw"} {
				skip = skip || strings.HasPrefix(n.name, prefix)
			}
			if !skip {
				selected = append(selected, n)
			}
		}
	}
	counters := map[string][2]float64{}
	names := []string{}
	var rx, tx float64
	for _, n := range selected {
		names = append(names, n.name)
		counters[n.name] = [2]float64{n.rx, n.tx}
		delete(wanted, n.name)
		if old, ok := c.previousNet[n.name]; ok {
			rx += math.Max(0, n.rx-old[0])
			tx += math.Max(0, n.tx-old[1])
		}
	}
	elapsed := now.Sub(c.previousTime).Seconds()
	network := Network{Interfaces: names}
	if !c.previousTime.IsZero() && elapsed > 0 {
		network.RX = rx / elapsed
		network.TX = tx / elapsed
	} else {
		rx = 0
		tx = 0
	}
	diskIO := map[string]DiskIO{}
	if c.Config.Collection.Disks.Enabled {
		raw, err := os.ReadFile("/proc/diskstats")
		current := parseDiskstats(string(raw), func(name string) bool {
			return !strings.HasPrefix(name, "loop") && !strings.HasPrefix(name, "ram") && !strings.HasPrefix(name, "zram") && exists("/sys/block/"+name)
		})
		diskIO = diskDeltas(current, c.previousDisk, elapsed)
		c.previousDisk = current
		c.mu.Lock()
		if err != nil {
			c.diagnostics["disk_io"] = "Не удалось прочитать /proc/diskstats"
		} else {
			delete(c.diagnostics, "disk_io")
		}
		c.mu.Unlock()
	}
	c.previousNet = counters
	c.previousTime = now
	model := runtime.GOARCH
	for _, line := range strings.Split(read("/proc/cpuinfo"), "\n") {
		key, val, ok := strings.Cut(line, ":")
		if ok && (strings.TrimSpace(key) == "model name" || strings.TrimSpace(key) == "Hardware") {
			model = strings.TrimSpace(val)
			break
		}
	}
	osname := "Linux"
	for _, line := range strings.Split(read("/etc/os-release"), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			osname = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"'")
		}
	}
	uptime := 0.0
	if f := strings.Fields(read("/proc/uptime")); len(f) > 0 {
		uptime = number(f[0])
	}
	c.mu.Lock()
	if len(wanted) > 0 {
		missing := []string{}
		for name := range wanted {
			missing = append(missing, name)
		}
		c.diagnostics["network"] = "Не найдены интерфейсы: " + strings.Join(missing, ", ")
	} else {
		delete(c.diagnostics, "network")
	}
	diagnostics := map[string]string{}
	for k, v := range c.diagnostics {
		diagnostics[k] = v
	}
	m := Metrics{DiskIO: diskIO, Timestamp: float64(now.UnixNano()) / 1e9, Interval: c.Config.Collection.Interval, AgentID: c.ID, AgentVersion: Version, Hostname: hostname, OS: osname, Platform: "Linux", CPU: CPU{usage, runtime.NumCPU(), model}, Memory: Memory{mt, used, math.Round(float64(used)/float64(mt)*1000) / 10}, Network: network, Uptime: uptime, Disks: c.disks, GPUs: c.gpus, Diagnostics: diagnostics}
	c.latest = &m
	c.mu.Unlock()
	if usage != nil && c.History != nil {
		return c.History.Sample(m, rx, tx)
	}
	return nil
}
func setHistory(c *Collector, h *History) { c.History = h }
