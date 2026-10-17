//go:build linux

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func powerEligible(d Disk) bool {
	return d.Type == "HDD" && d.Serial != "" && d.Model != "" && d.Total > 0 && validATAName(d.Name) && (d.Interface == "sata" || d.Interface == "ata")
}

// Power belongs to the disk metadata collection cycle, never a browser request.
// This issues CHECK POWER MODE only, no SMART, reads, self-tests or settings.
func collectDiskPower(ctx context.Context, disks []Disk, now time.Time, cfg DiskConfig, h *History, run func(context.Context, ...string) ([]byte, error)) error {
	if !cfg.Enabled || !cfg.PowerState {
		return nil
	}
	if h == nil {
		return fmt.Errorf("disk power: persistent history is required")
	}
	started := time.Now()
	var errs []error
	for _, d := range disks {
		if !powerEligible(d) {
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		key := "power:" + smartIdentity(d)
		record, err := h.loadSMART(key)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		interval := max(60, cfg.Interval)
		if record.AttemptAt > 0 && float64(now.Unix())-record.AttemptAt < interval {
			continue
		}
		record.AttemptAt = float64(now.Unix())
		// Reserve a durable budget before commands, including failed attempts.
		reserved, err := h.reserveSMART(key, record, record.AttemptAt-interval)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if !reserved {
			continue
		}
		state, checkErr := readDiskPower(ctx, d, run)
		record.PowerState, record.PowerCheckedAt = state, float64(now.Add(time.Since(started)).Unix())
		record.PowerError = ""
		if checkErr != nil {
			record.PowerError = checkErr.Error()
			errs = append(errs, fmt.Errorf("%s power: %w", d.Name, checkErr))
		}
		if err := h.saveSMART(key, record); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func readDiskPower(ctx context.Context, d Disk, run func(context.Context, ...string) ([]byte, error)) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	// Fresh kernel/udev identity prevents trusting a renamed/replaced /dev/sdX.
	raw, err := run(ctx, "lsblk", "-dn", "-J", "-b", "-o", "NAME,SERIAL,MODEL,SIZE,TRAN,ROTA", "/dev/"+d.Name)
	if err != nil {
		return "unknown", fmt.Errorf("disk identity unavailable")
	}
	var inventory struct {
		Devices []struct {
			Name   string
			Serial string
			Model  string
			Size   json.RawMessage
			Tran   string
			Rota   json.RawMessage
		} `json:"blockdevices"`
	}
	if json.Unmarshal(raw, &inventory) != nil || len(inventory.Devices) != 1 {
		return "unknown", fmt.Errorf("invalid disk inventory")
	}
	live := inventory.Devices[0]
	if live.Name != d.Name || strings.TrimSpace(live.Serial) != d.Serial || strings.TrimSpace(live.Model) != d.Model || uint64(number(strings.Trim(string(live.Size), "\""))) != d.Total || (live.Tran != "sata" && live.Tran != "ata") || (string(live.Rota) != "true" && string(live.Rota) != "1" && string(live.Rota) != "\"1\"") {
		return "unknown", fmt.Errorf("disk identity or transport changed")
	}
	raw, err = run(ctx, "hdparm", "-C", "/dev/"+d.Name)
	if err != nil {
		return "unknown", fmt.Errorf("CHECK POWER MODE failed")
	}
	return normalizedPowerState(checkPowerMode(raw)), nil
}

func normalizedPowerState(state string) string {
	switch state {
	case "active/idle", "active", "idle":
		return "active"
	case "sleeping", "sleep":
		return "sleep"
	case "standby":
		return "standby"
	default:
		return "unknown"
	}
}

// Metrics carry a recent observation, timestamp and an explicit collection error.
// Old readings must never survive as a current sleeping/rotating indicator.
func loadDiskPowerObservation(d *Disk, h *History, now time.Time, cfg DiskConfig) error {
	if d.Type != "HDD" {
		return nil
	}
	d.PowerState, d.PowerError, d.PowerCheckedAt = "unknown", "", nil
	d.PowerInterval = max(60, cfg.Interval)
	if !cfg.Enabled || !cfg.PowerState || !powerEligible(*d) || h == nil {
		return nil
	}
	record, err := h.loadSMART("power:" + smartIdentity(*d))
	if err != nil {
		return err
	}
	if record.PowerCheckedAt <= 0 {
		return nil
	}
	d.PowerCheckedAt = ptr(record.PowerCheckedAt)
	age := float64(now.Unix()) - record.PowerCheckedAt
	if age < 0 || age > max(120, cfg.Interval*2) {
		return nil
	}
	d.PowerState, d.PowerError = normalizedPowerState(record.PowerState), record.PowerError
	return nil
}
