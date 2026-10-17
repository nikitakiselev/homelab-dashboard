package agent

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConfigRejectsInvalidYAML(t *testing.T) {
	for _, raw := range []string{"server:\n  port: 0", "server:\n  port: 9108\n  port: 9109", "server:\n  unknown: true", "server:\n  port: '9108'", "collection:\n  interval_seconds: .nan", "collection:\n  disks:\n    enabled: 'false'", "network:\n  interfaces: [false]", "history:\n  retention_days: false", "history: null", "token: secret", "server: {}\n---\nserver: {}"} {
		t.Run(raw, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "agent.yaml")
			os.WriteFile(p, []byte(raw), 0600)
			if _, err := LoadConfig(p); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}
func TestConfigPortAndRelativeHistory(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.yaml")
	os.WriteFile(p, []byte("server:\n  port: 19108\ncollection:\n  interval_seconds: 12\nhistory:\n  path: metrics/agent.sqlite\n"), 0600)
	c, err := LoadConfig(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.Server.Port != 19108 || c.Collection.Interval != 12 || c.History.Path != filepath.Join(dir, "metrics/agent.sqlite") {
		t.Fatalf("unexpected config: %+v", c)
	}
}
func TestInitPreservesLegacyCredentialsAndConfig(t *testing.T) {
	dir := t.TempDir()
	env := filepath.Join(dir, "agent.env")
	config := filepath.Join(dir, "agent.yaml")
	old := []byte("HOMELAB_AGENT_TOKEN=preserve-this-existing-test-token\nHOMELAB_AGENT_PORT=19108\nHOMELAB_INTERFACES=eth9\n")
	os.WriteFile(env, old, 0600)
	if err := Init(config, env); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if c.Server.Port != 19108 || c.Network.Interfaces[0] != "eth9" {
		t.Fatal("legacy settings lost")
	}
	before, _ := os.ReadFile(config)
	if err = Init(config, env); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(config)
	actual, _ := os.ReadFile(env)
	if string(before) != string(after) || string(actual) != string(old) {
		t.Fatal("existing configuration changed")
	}
}
func TestHistoryReopensExistingSQLiteAndReplacesBucket(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.sqlite")
	h, err := OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	m := Metrics{Timestamp: float64(time.Now().Unix()), AgentID: "legacy-machine-id", CPU: CPU{Usage: ptr(20)}, Memory: Memory{Percent: 40}, GPUs: []GPU{}, Network: Network{RX: 2, TX: 3}}
	if err = h.Sample(m, 10, 15); err != nil {
		t.Fatal(err)
	}
	m.CPU.Usage = ptr(40)
	if err = h.Sample(m, 20, 30); err != nil {
		t.Fatal(err)
	}
	h.Close()
	h, err = OpenHistory(path, 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	r, err := h.Read(m.AgentID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(r) != 1 || r[0]["cpu"] != float64(30) || r[0]["rx_bytes"] != float64(30) || r[0]["samples"] != int64(2) {
		t.Fatalf("unexpected history: %+v", r)
	}
}

type fakeCollector struct{ m *Metrics }

func (f fakeCollector) Snapshot() *Metrics { return f.m }
func TestAPIAuthVersionHistoryAndStaleData(t *testing.T) {
	c := DefaultConfig()
	h, err := OpenHistory(filepath.Join(t.TempDir(), "agent.sqlite"), 90)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	m := &Metrics{Timestamp: float64(time.Now().Unix()), AgentID: "test-host", AgentVersion: Version, Disks: []Disk{}, GPUs: []GPU{}}
	handler := Handler(c, "test-token", fakeCollector{m}, h)
	for _, test := range []struct {
		path, token string
		code        int
	}{{"/v1/metrics", "", 401}, {"/v1/metrics", "test-token", 200}, {"/v1/history?since=no", "test-token", 400}, {"/v1/history?since=0", "test-token", 200}, {"/bad", "test-token", 404}} {
		req := httptest.NewRequest("GET", test.path, nil)
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != test.code {
			t.Fatalf("%s got %d", test.path, w.Code)
		}
		if test.code == 200 && test.path == "/v1/metrics" {
			var data Metrics
			if err = json.Unmarshal(w.Body.Bytes(), &data); err != nil || data.AgentVersion != Version {
				t.Fatal("API lost version")
			}
		}
	}
	m.Timestamp -= 1000
	req := httptest.NewRequest("GET", "/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 503 {
		t.Fatal("stale metrics accepted")
	}
}
func TestOversizedConfig(t *testing.T) {
	p := filepath.Join(t.TempDir(), "agent.yaml")
	os.WriteFile(p, []byte(strings.Repeat(" ", 65537)), 0600)
	if _, err := LoadConfig(p); err == nil {
		t.Fatal("oversized config accepted")
	}
}

func TestExplicitInvalidPortOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.yaml")
	os.WriteFile(path, []byte("server:\n  port: 19108\n"), 0600)
	if err := CLI([]string{"run", "--config", path, "--port", "0"}); err == nil || !strings.Contains(err.Error(), "port") {
		t.Fatal("invalid explicit port was accepted")
	}
}
