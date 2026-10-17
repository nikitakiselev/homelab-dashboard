package agent

import (
	"database/sql"
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
 host TEXT, bucket INTEGER, cpu REAL, memory REAL, gpu REAL, rx REAL, tx REAL, rx_bytes REAL, tx_bytes REAL, samples INTEGER, PRIMARY KEY(host,bucket))`)
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
	if _, err = t.Exec("DELETE FROM history WHERE bucket < ?", time.Now().Unix()-int64(h.days)*86400); err != nil {
		return err
	}
	return t.Commit()
}
func (h *History) Read(host string, since int64) ([]map[string]any, error) {
	if min := time.Now().Unix() - int64(h.days)*86400; since < min {
		since = min
	}
	rows, err := h.db.Query("SELECT host,bucket,cpu,memory,gpu,rx,tx,rx_bytes,tx_bytes,samples FROM history WHERE host=? AND bucket>=? ORDER BY bucket LIMIT 1000", host, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var host string
		var bucket, samples int64
		var cpu, mem, gpu, rx, tx, rb, tb sql.NullFloat64
		if err = rows.Scan(&host, &bucket, &cpu, &mem, &gpu, &rx, &tx, &rb, &tb, &samples); err != nil {
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
		out = append(out, values)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	return out, nil
}
