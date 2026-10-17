//go:build linux

package agent

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// A failed/skipped attempt consumes the same budget as a successful read.
// Reserve it durably BEFORE even checking power, including on first startup.
type smartRecord struct {
	AttemptAt float64         `json:"attempt_at"`
	SampleAt  float64         `json:"sample_at"`
	Raw       json.RawMessage `json:"raw,omitempty"`
	Outcome   string          `json:"outcome"`
}

func smartIdentity(d Disk) string {
	raw, _ := json.Marshal([]any{d.Serial, d.Model, d.Total})
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

func (h *History) loadSMART(key string) (smartRecord, error) {
	var record smartRecord
	var raw string
	err := h.db.QueryRow("SELECT payload FROM smart_cache WHERE identity=?", key).Scan(&raw)
	if err == sql.ErrNoRows {
		return record, nil
	}
	if err != nil {
		return record, err
	}
	err = json.Unmarshal([]byte(raw), &record)
	return record, err
}

func (h *History) reserveSMART(key string, record smartRecord, cutoff float64) (bool, error) {
	raw, err := json.Marshal(record)
	if err != nil {
		return false, err
	}
	result, err := h.db.Exec(`INSERT INTO smart_cache VALUES (?,?) ON CONFLICT(identity) DO UPDATE SET payload=excluded.payload WHERE json_extract(smart_cache.payload,'$.attempt_at')<=?`, key, string(raw), cutoff)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n == 1, err
}

func (h *History) saveSMART(key string, record smartRecord) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = h.db.Exec("UPDATE smart_cache SET payload=? WHERE identity=?", string(raw), key)
	return err
}

func smartSerial(raw []byte) string {
	var data struct {
		Serial string `json:"serial_number"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return ""
	}
	return data.Serial
}

func applySMARTRecord(d *Disk, record smartRecord) {
	if record.SampleAt > 0 && smartSerial(record.Raw) == d.Serial {
		applySMART(d, record.Raw)
		if d.SMARTState == "fresh" {
			d.SMARTUpdatedAt = ptr(record.SampleAt)
		}
	}
	// A previous SMART read is not a measurement of the CURRENT power state.
	d.PowerState = "unknown"
	if record.AttemptAt > 0 {
		d.SMARTAttemptAt = ptr(record.AttemptAt)
	}
}

func checkPowerMode(raw []byte) string {
	for _, line := range strings.Split(string(raw), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if ok && key == "drive state is" {
			switch value = strings.TrimSpace(value); value {
			case "active/idle", "active", "idle", "standby", "sleeping":
				return value
			}
		}
	}
	return "unknown"
}

// Opt-in, serial-scoped, at most daily ATA snapshots during observed block I/O.
// Activity is an opportunity, not proof that heads are loaded. CHECK POWER MODE
// and smartctl's own guard reduce races; hardware/bridge behavior needs testing.
func collectScheduledSMART(ctx context.Context, disks []Disk, activity map[string]time.Time, now time.Time, cfg SMARTConfig, h *History, run func(context.Context, ...string) ([]byte, error)) error {
	if h == nil {
		if cfg.Enabled {
			return fmt.Errorf("SMART: persistent history is required")
		}
		return nil
	}
	allowed := map[string]bool{}
	for _, serial := range cfg.Serials {
		allowed[serial] = true
	}
	var errs []error
	started := time.Now()
	for i := range disks {
		// Account for time spent on earlier devices in this batch.
		observedAt := now.Add(time.Since(started))
		d := &disks[i]
		if d.Serial == "" || d.Type == "NVMe" {
			continue
		}
		key := smartIdentity(*d)
		record, err := h.loadSMART(key)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s SMART cache: %w", d.Name, err))
			continue
		}
		applySMARTRecord(d, record)
		d.SMARTState = "passive"
		// No autodetection, SAT/USB/SAS/RAID fallback, or arbitrary device paths.
		if !cfg.Enabled || !allowed[d.Serial] || (d.Interface != "sata" && d.Interface != "ata") || !validATAName(d.Name) {
			continue
		}
		d.SMARTState = "waiting_activity"
		if record.SampleAt > 0 {
			d.SMARTState = "cached"
		}
		interval := cfg.Interval
		if interval < 86400 {
			interval = 86400
		} // Defense even for programmatic configs.
		if record.AttemptAt > 0 && float64(observedAt.Unix())-record.AttemptAt < interval {
			if record.Outcome != "fresh" {
				d.SMARTState = record.Outcome
			}
			continue
		}
		at := activity[d.Name]
		if at.IsZero() || observedAt.Before(at) || observedAt.Sub(at) > 15*time.Second {
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		record.AttemptAt, record.Outcome = float64(observedAt.Unix()), "cooldown"
		reserved, err := h.reserveSMART(key, record, record.AttemptAt-interval)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s SMART reservation: %w", d.Name, err))
			continue
		}
		if !reserved {
			continue
		}
		d.SMARTAttemptAt, d.SMARTState = ptr(record.AttemptAt), "cooldown"
		power, powerErr := run(ctx, "hdparm", "-C", "/dev/"+d.Name)
		mode := checkPowerMode(power)
		if powerErr == nil && (mode == "active/idle" || mode == "active" || mode == "idle") {
			raw, commandErr := run(ctx, "smartctl", "-i", "-H", "-A", "-j", "-d", "ata", "-n", "standby,75,76", "/dev/"+d.Name)
			// smartctl returns nonzero for health warnings and guarded skips too.
			// Parse its JSON rather than discarding useful output based on exit code.
			candidate := *d
			applySMART(&candidate, raw)
			switch candidate.SMARTState {
			case "fresh":
				if smartSerial(raw) == d.Serial {
					record.Raw, record.SampleAt, record.Outcome = append(json.RawMessage(nil), raw...), float64(now.Add(time.Since(started)).Unix()), "fresh"
					candidate.SMARTUpdatedAt = ptr(record.SampleAt)
					*d = candidate
				} else {
					record.Outcome = "unavailable"
					errs = append(errs, fmt.Errorf("%s SMART identity mismatch; sample rejected", d.Name))
				}
			case "sleeping", "unsupported":
				record.Outcome = candidate.SMARTState
				d.PowerState = candidate.PowerState
			default:
				record.Outcome = "unavailable"
				if commandErr == nil {
					commandErr = errors.New("no usable SMART data")
				}
				errs = append(errs, fmt.Errorf("%s SMART read failed: %w", d.Name, commandErr))
			}
		} else {
			record.Outcome = "power_unknown"
			if powerErr == nil && (mode == "standby" || mode == "sleeping") {
				record.Outcome, d.PowerState = "sleeping", "standby"
			} else {
				errs = append(errs, fmt.Errorf("%s power state unavailable; SMART skipped", d.Name))
			}
		}
		if record.Outcome != "fresh" {
			d.SMARTState = record.Outcome
		}
		if err := h.saveSMART(key, record); err != nil {
			errs = append(errs, fmt.Errorf("%s SMART cache write: %w", d.Name, err))
		}
	}
	return errors.Join(errs...)
}

func validATAName(name string) bool {
	if !strings.HasPrefix(name, "sd") || len(name) < 3 {
		return false
	}
	for _, c := range name[2:] {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}
