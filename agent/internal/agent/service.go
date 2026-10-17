package agent

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

var Version = "0.2.1"

func Serve(c Config, token string) error {
	collector, err := NewCollector(c, nil)
	if err != nil {
		return err
	}
	// Bind before creating history or workers, so port conflicts fail immediately.
	listener, err := net.Listen("tcp", net.JoinHostPort(c.Server.Bind, strconv.Itoa(c.Server.Port)))
	if err != nil {
		return fmt.Errorf("cannot listen on %s:%d (check whether the port is already in use): %w", c.Server.Bind, c.Server.Port, err)
	}
	defer listener.Close()
	history, err := OpenHistory(c.History.Path, c.History.Days)
	if err != nil {
		return err
	}
	defer history.Close()
	setHistory(collector, history)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan struct{})
	go func() { collector.Run(ctx); close(done) }()
	defer func() { stop(); <-done }()
	server := &http.Server{Handler: Handler(c, token, collector, history), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	fmt.Printf("homelab-agent %s listening on %s\n", Version, listener.Addr())
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

type snapshotter interface{ Snapshot() *Metrics }

func Handler(c Config, token string, collector snapshotter, h *History) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "Unauthorized", 401)
			return
		}
		if r.Method != "GET" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		m := collector.Snapshot()
		if m == nil || time.Since(time.Unix(0, int64(m.Timestamp*1e9))).Seconds() > max(30, c.Collection.Interval*3) {
			http.Error(w, "Metrics unavailable or stale", 503)
			return
		}
		var value any
		switch r.URL.Path {
		case "/v1/metrics":
			value = m
		case "/v1/history":
			since := int64(0)
			if s := r.URL.Query().Get("since"); s != "" {
				var err error
				since, err = strconv.ParseInt(s, 10, 64)
				if err != nil {
					http.Error(w, "Invalid since", 400)
					return
				}
			}
			records, err := h.Read(m.AgentID, since)
			if err != nil {
				http.Error(w, "History unavailable", 500)
				return
			}
			value = map[string]any{"records": records}
		default:
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(value)
	})
}
