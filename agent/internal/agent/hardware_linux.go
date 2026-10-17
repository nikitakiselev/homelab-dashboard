//go:build linux

package agent

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func command(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, args[0], args[1:]...).Output()
	return out, err
}
func ReadDisks(ctx context.Context) ([]Disk, error) {
	return readDisks(ctx, nil, command)
}

// ATA devices are passive: never send SMART/power commands or probe HDD filesystems.
func readDisks(ctx context.Context, previous []Disk, run func(context.Context, ...string) ([]byte, error)) ([]Disk, error) {
	out, err := run(ctx, "lsblk", "-J", "-b", "-o", "NAME,TYPE,SIZE,MODEL,SERIAL,REV,ROTA,TRAN,MOUNTPOINTS")
	if err != nil {
		return []Disk{}, fmt.Errorf("lsblk: %w", err)
	}
	type device struct {
		Name        string
		Type        string
		Size        json.RawMessage
		Serial      string
		Rev         string
		Tran        string
		Model       string
		Rota        json.RawMessage
		Mountpoints []*string
		Children    []json.RawMessage
	}
	var raw struct{ Blockdevices []json.RawMessage }
	if err = json.Unmarshal(out, &raw); err != nil {
		return []Disk{}, err
	}
	// Shared ZFS/RAID/LVM mounts can involve an HDD even when discovered under
	// an SSD. Without complete pool topology, skip filesystem probes host-wide.
	passiveFilesystems := false
	for _, entry := range raw.Blockdevices {
		var d device
		if json.Unmarshal(entry, &d) != nil {
			passiveFilesystems = true
			continue
		}
		knownSSD := strings.HasPrefix(d.Name, "nvme") || string(d.Rota) == "false" || string(d.Rota) == "0" || string(d.Rota) == "\"0\""
		if d.Type == "disk" && !knownSSD && !strings.HasPrefix(d.Name, "loop") && !strings.HasPrefix(d.Name, "ram") && !strings.HasPrefix(d.Name, "zram") {
			passiveFilesystems = true
		}
	}
	disks := []Disk{}
	seen := map[uint64]bool{}
	for _, entry := range raw.Blockdevices {
		var d device
		if err = json.Unmarshal(entry, &d); err != nil {
			continue
		}
		if d.Type != "disk" || strings.HasPrefix(d.Name, "loop") || strings.HasPrefix(d.Name, "ram") || strings.HasPrefix(d.Name, "zram") {
			continue
		}
		mounts := map[string]bool{}
		var walk func(device)
		walk = func(node device) {
			for _, m := range node.Mountpoints {
				if m != nil && strings.HasPrefix(*m, "/") {
					mounts[*m] = true
				}
			}
			for _, r := range node.Children {
				var child device
				if json.Unmarshal(r, &child) == nil {
					walk(child)
				}
			}
		}
		walk(d)
		disk := Disk{Name: d.Name, Model: strings.TrimSpace(d.Model), Type: "HDD", Total: uint64(number(strings.Trim(string(d.Size), "\""))), Health: "unknown", Volumes: []Volume{}}
		if disk.Model == "" {
			disk.Model = d.Name
		}
		if strings.HasPrefix(d.Name, "nvme") {
			disk.Type = "NVMe"
		} else if string(d.Rota) == "false" || string(d.Rota) == "0" || string(d.Rota) == "\"0\"" {
			disk.Type = "SSD"
		}
		disk.Serial, disk.Firmware, disk.Interface = strings.TrimSpace(d.Serial), strings.TrimSpace(d.Rev), d.Tran
		// Reuse samples only when the physical identity matches; never just /dev/sdX.
		for _, old := range previous {
			if disk.Serial != "" && old.Serial == disk.Serial && old.Model == disk.Model && old.Total == disk.Total {
				disk = old
				disk.Name, disk.Interface = d.Name, d.Tran
				break
			}
		}
		disk.PowerState, disk.SMARTState = "unknown", "unavailable"
		// Even a standby-guarded SMART request can reset an awake HDD's idle
		// timer or unpark its heads. Never poll ATA/SATA/USB devices.
		if args := diskSMARTArgs(disk.Name, d.Tran); args != nil {
			smart, _ := run(ctx, args...)
			applySMART(&disk, smart)
		} else {
			disk.SMARTState = "passive"
		}
		// Cached active status is not permission to touch a rotational disk.
		if disk.Type == "HDD" || passiveFilesystems {
			disks = append(disks, disk)
			continue
		}

		disk.Volumes, disk.Used, disk.MountedTotal = []Volume{}, 0, 0
		for mount := range mounts {
			var st syscall.Stat_t
			var fs syscall.Statfs_t
			if syscall.Stat(mount, &st) != nil || seen[st.Dev] || syscall.Statfs(mount, &fs) != nil {
				continue
			}
			seen[st.Dev] = true
			total := fs.Blocks * uint64(fs.Bsize)
			used := total - fs.Bfree*uint64(fs.Bsize)
			disk.Volumes = append(disk.Volumes, Volume{mount, total, used})
			disk.Used += used
			disk.MountedTotal += total
		}
		disk.UsageUpdatedAt = ptr(float64(time.Now().Unix()))
		disks = append(disks, disk)
	}
	return disks, nil
}

// Only NVMe SMART is polled. No ATA commands, including CHECK POWER MODE.
func diskSMARTArgs(name, transport string) []string {
	if strings.HasPrefix(name, "nvme") {
		return []string{"smartctl", "-a", "-j", "-d", "nvme", "/dev/" + name}
	}
	return nil
}

func applySMART(d *Disk, raw []byte) {
	var s struct {
		Smartctl struct {
			ExitStatus int `json:"exit_status"`
		} `json:"smartctl"`
		PowerMode struct {
			Name string `json:"name"`
		} `json:"power_mode"`
		Serial       string   `json:"serial_number"`
		Firmware     string   `json:"firmware_version"`
		RotationRate *float64 `json:"rotation_rate"`
		PowerOn      struct {
			Hours *float64 `json:"hours"`
		} `json:"power_on_time"`
		PowerCycles *float64 `json:"power_cycle_count"`
		Status      struct {
			Passed *bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current *float64 `json:"current"`
		} `json:"temperature"`
		NVMe struct {
			Critical    float64  `json:"critical_warning"`
			Used        *float64 `json:"percentage_used"`
			Spare       *float64 `json:"available_spare"`
			MediaErrors *float64 `json:"media_errors"`
		} `json:"nvme_smart_health_information_log"`
		ATA struct {
			Table []struct {
				ID  int `json:"id"`
				Raw struct {
					Value *float64 `json:"value"`
				} `json:"raw"`
			} `json:"table"`
		} `json:"ata_smart_attributes"`
	}
	d.PowerState, d.SMARTState = "unknown", "unavailable"
	if json.Unmarshal(raw, &s) != nil {
		return
	}
	if s.Smartctl.ExitStatus == 75 {
		d.PowerState, d.SMARTState = "standby", "sleeping"
		if strings.EqualFold(s.PowerMode.Name, "SLEEP") {
			d.PowerState = "sleep"
		}
		return
	}
	if s.Smartctl.ExitStatus == 76 {
		d.SMARTState = "unsupported"
		return
	}
	// Bits 0..1 indicate CLI/open failures; bit 2 can accompany useful SMART data.
	if s.Smartctl.ExitStatus&3 != 0 {
		return
	}
	if s.Status.Passed == nil && s.Temperature.Current == nil && s.PowerOn.Hours == nil && len(s.ATA.Table) == 0 && s.NVMe.Used == nil && s.NVMe.Critical == 0 {
		return
	}
	d.PowerState, d.SMARTState = "active", "fresh"
	d.SMARTUpdatedAt = ptr(float64(time.Now().Unix()))
	d.Health, d.Warning = "unknown", nil
	if s.Status.Passed != nil {
		if *s.Status.Passed {
			d.Health = "healthy"
		} else {
			d.Health = "failed"
		}
	}
	if s.Serial != "" {
		d.Serial = s.Serial
	}
	if s.Firmware != "" {
		d.Firmware = s.Firmware
	}
	d.RotationRate, d.Temperature = s.RotationRate, s.Temperature.Current
	d.PowerOnHours, d.PowerCycles = s.PowerOn.Hours, s.PowerCycles
	d.PercentageUsed, d.AvailableSpare, d.MediaErrors = s.NVMe.Used, s.NVMe.Spare, s.NVMe.MediaErrors
	d.ReallocatedSectors, d.PendingSectors, d.UncorrectableSectors = nil, nil, nil
	warn := func(text string) {
		if d.Health != "failed" {
			d.Health = "warning"
		}
		d.Warning = &text
	}
	if s.NVMe.Critical > 0 {
		warn("Предупреждение NVMe")
	}
	if s.NVMe.Used != nil && *s.NVMe.Used >= 100 {
		warn("Ресурс записи исчерпан")
	}
	for _, a := range s.ATA.Table {
		switch a.ID {
		case 5:
			d.ReallocatedSectors = a.Raw.Value
		case 197:
			d.PendingSectors = a.Raw.Value
		case 198:
			d.UncorrectableSectors = a.Raw.Value
		}
		if (a.ID == 5 || a.ID == 197 || a.ID == 198) && a.Raw.Value != nil && *a.Raw.Value > 0 {
			warn("Проверьте повреждённые или переназначенные секторы")
		}
	}
}
func ReadGPUs(ctx context.Context) ([]GPU, error) {
	result := []GPU{}
	errors := []string{}
	if _, err := exec.LookPath("nvidia-smi"); err == nil {
		out, err := command(ctx, "nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
		if err != nil {
			errors = append(errors, "nvidia-smi: "+err.Error())
		}
		reader := csv.NewReader(bytes.NewReader(out))
		reader.TrimLeadingSpace = true
		for {
			r, err := reader.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			if len(r) != 5 {
				continue
			}
			v := GPU{Name: strings.TrimSpace(r[0])}
			fields := []**float64{&v.Usage, &v.MemoryUsed, &v.MemoryTotal, &v.Temperature}
			for i, dest := range fields {
				if n, err := strconv.ParseFloat(strings.TrimSpace(r[i+1]), 64); err == nil {
					if i == 1 || i == 2 {
						n *= 1048576
					}
					*dest = ptr(n)
				}
			}
			result = append(result, v)
		}
	}
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*")
	for _, card := range cards {
		if strings.Contains(filepath.Base(card), "-") {
			continue
		}
		if read(card+"/device/vendor") == "0x8086" {
			gpu, err := intelGPU(ctx, filepath.Base(card))
			if err != nil {
				errors = append(errors, err.Error())
				result = append(result, GPU{Name: "Intel GPU", Shared: true})
			} else {
				result = append(result, gpu)
			}
			continue
		}
		if busy := read(card + "/device/gpu_busy_percent"); busy != "" {
			name := read(card + "/device/product_name")
			if name == "" {
				name = "AMD GPU"
			}
			result = append(result, GPU{Name: name, Usage: ptr(number(busy)), MemoryUsed: ptr(number(read(card + "/device/mem_info_vram_used"))), MemoryTotal: ptr(number(read(card + "/device/mem_info_vram_total")))})
		}
	}
	if len(errors) > 0 {
		return result, fmt.Errorf("%s", strings.Join(errors, "; "))
	}
	return result, nil
}
func intelGPU(ctx context.Context, card string) (GPU, error) {
	g := GPU{Name: "Intel GPU (i915)", Shared: true, Engines: map[string]float64{}}
	cmd := exec.CommandContext(ctx, "intel_gpu_top", "-J", "-s", "500", "-d", "drm:/dev/dri/"+card, "-o", "-")
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return g, fmt.Errorf("Intel GPU: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-ctx.Done():
		cmd.Process.Kill()
		<-done
		return g, ctx.Err()
	case <-time.After(1300 * time.Millisecond):
		cmd.Process.Signal(syscall.SIGINT)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			cmd.Process.Kill()
			<-done
		}
	}
	data := strings.TrimSpace(out.String())
	data = strings.TrimLeft(data, "[ \r\n")
	dec := json.NewDecoder(strings.NewReader(data))
	for {
		var sample struct {
			Engines map[string]struct {
				Busy *float64 `json:"busy"`
			} `json:"engines"`
		}
		if dec.Decode(&sample) != nil {
			break
		}
		if len(sample.Engines) > 0 {
			g.Engines = map[string]float64{}
			max := 0.0
			for name, e := range sample.Engines {
				if e.Busy != nil {
					g.Engines[name] = *e.Busy
					if *e.Busy > max {
						max = *e.Busy
					}
				}
			}
			if len(g.Engines) > 0 {
				if max > 100 {
					max = 100
				}
				if max < 0 {
					max = 0
				}
				g.Usage = &max
			}
		}
		var comma json.RawMessage
		_ = comma
		// intel_gpu_top separates complete records with commas; advance decoder manually below.
		offset := dec.InputOffset()
		remaining := strings.TrimLeft(data[offset:], ", \r\n")
		if remaining == "" || strings.HasPrefix(remaining, "]") {
			break
		}
		data = remaining
		dec = json.NewDecoder(strings.NewReader(data))
	}
	if g.Usage == nil {
		return g, fmt.Errorf("Intel GPU counters unavailable: %.180s", stderr.String())
	}
	return g, nil
}
