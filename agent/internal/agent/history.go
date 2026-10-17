package agent

import (
	"database/sql"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"time"
)

type History struct {
	db   *sql.DB
	days int
}

func OpenHistory(path string, days int) (*History, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA busy_timeout=15000; CREATE TABLE IF NOT EXISTS history (
 host TEXT, bucket INTEGER, cpu REAL, memory REAL, gpu REAL, rx REAL, tx REAL, rx_bytes REAL, tx_bytes REAL, samples INTEGER, PRIMARY KEY(host,bucket)); CREATE TABLE IF NOT EXISTS smart_cache (identity TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS disk_history (host TEXT, bucket INTEGER, payload TEXT NOT NULL, PRIMARY KEY(host,bucket))`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &History{db, days}, nil
}
func (h *History) Close() error { return h.db.Close() }
func (h *History) Sample(m Metrics, rx, tx float64) error {
	var gpu *float64
	if len(m.GPUs) > 0 {
		gpu = m.GPUs[0].Usage
	}
	t, err := h.db.Begin()
	if err != nil {
		return err
	}
	defer t.Rollback()
	_, err = t.Exec(`INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(host,bucket) DO UPDATE SET
 cpu=(cpu*samples+excluded.cpu)/(samples+1),memory=(memory*samples+excluded.memory)/(samples+1),gpu=COALESCE(excluded.gpu,gpu),
 rx=(rx*samples+excluded.rx)/(samples+1),tx=(tx*samples+excluded.tx)/(samples+1),rx_bytes=rx_bytes+excluded.rx_bytes,tx_bytes=tx_bytes+excluded.tx_bytes,samples=samples+1`, m.AgentID, int64(m.Timestamp)/300*300, m.CPU.Usage, m.Memory.Percent, gpu, m.Network.RX, m.Network.TX, rx, tx, 1)
	if err != nil {
		return err
	}
	if len(m.DiskIO) > 0 {
		combined := map[string]DiskIO{}
		var raw string
		scanErr := t.QueryRow("SELECT payload FROM disk_history WHERE host=? AND bucket=?", m.AgentID, int64(m.Timestamp)/300*300).Scan(&raw)
		if scanErr != nil && scanErr != sql.ErrNoRows {
			return scanErr
		}
		if raw != "" {
			if err = json.Unmarshal([]byte(raw), &combined); err != nil {
				return err
			}
		}
		addDiskIO(combined, m.DiskIO)
		payload, marshalErr := json.Marshal(combined)
		if marshalErr != nil {
			return marshalErr
		}
		if _, err = t.Exec("INSERT OR REPLACE INTO disk_history VALUES (?,?,?)", m.AgentID, int64(m.Timestamp)/300*300, string(payload)); err != nil {
			return err
		}
	}
	if _, err = t.Exec("DELETE FROM disk_history WHERE bucket < ?", time.Now().Unix()-int64(h.days)*86400); err != nil {
		return err
	}
	if _, err = t.Exec("DELETE FROM history WHERE bucket < ?", time.Now().Unix()-int64(h.days)*86400); err != nil {
		return err
	}
	return t.Commit()
}
func (h *History) Read(host string, since int64) ([]map[string]any, error) {
	if min := time.Now().Unix() - int64(h.days)*86400; since < min {
		since = min
	}
	rows, err := h.db.Query("SELECT h.host,h.bucket,cpu,memory,gpu,rx,tx,rx_bytes,tx_bytes,samples,d.payload FROM history h LEFT JOIN disk_history d ON d.host=h.host AND d.bucket=h.bucket WHERE h.host=? AND h.bucket>=? ORDER BY h.bucket LIMIT 1000", host, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	size := 0
	for rows.Next() {
		var host string
		var payload sql.NullString
		var bucket, samples int64
		var cpu, mem, gpu, rx, tx, rb, tb sql.NullFloat64
		if err = rows.Scan(&host, &bucket, &cpu, &mem, &gpu, &rx, &tx, &rb, &tb, &samples, &payload); err != nil {
			return nil, err
		}
		values := map[string]any{"host": host, "bucket": bucket, "samples": samples}
		for k, v := range map[string]sql.NullFloat64{"cpu": cpu, "memory": mem, "gpu": gpu, "rx": rx, "tx": tx, "rx_bytes": rb, "tx_bytes": tb} {
			if v.Valid {
				values[k] = v.Float64
			} else {
				values[k] = nil
			}
		}
		if payload.Valid {
			var disks map[string]DiskIO
			if err = json.Unmarshal([]byte(payload.String), &disks); err != nil {
				return nil, err
			}
			values["disk_io"] = disks
		}
		encoded, encodeErr := json.Marshal(values)
		if encodeErr != nil {
			return nil, encodeErr
		}
		if size+len(encoded) > 1_000_000 && len(out) > 0 {
			break
		}
		size += len(encoded)
		out = append(out, values)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	return out, nil
}

func (h *History) hasMore(host string, after int64) (bool, error) {
	var more bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM history WHERE host=? AND bucket>?)", host, after).Scan(&more)
	return more, err
}
