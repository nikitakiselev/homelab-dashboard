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

func TestConfigDefaultsToLoopback(t *testing.T) {
	c, err := LoadConfig("")
	if err != nil || c.Server.Bind != "127.0.0.1" {
		t.Fatalf("default listener is not loopback: %+v, %v", c.Server, err)
	}
	for _, tc := range []struct{ raw, bind string }{
		{"", "127.0.0.1"},
		{"server:\n  port: 19108\n", "127.0.0.1"},
		{"server:\n  bind: 192.0.2.10\n", "192.0.2.10"},
		{"server:\n  bind: 0.0.0.0\n", "0.0.0.0"},
	} {
		p := filepath.Join(t.TempDir(), "agent.yaml")
		if err := os.WriteFile(p, []byte(tc.raw), 0600); err != nil {
			t.Fatal(err)
		}
		c, err := LoadConfig(p)
		if err != nil || c.Server.Bind != tc.bind {
			t.Fatalf("%q: %+v, %v", tc.raw, c.Server, err)
		}
	}
}

func TestInitUsesLoopbackAndPreservesExplicitListener(t *testing.T) {
	dir := t.TempDir()
	config, env := filepath.Join(dir, "agent.yaml"), filepath.Join(dir, "agent.env")
	if err := Init(config, env); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(config)
	if err != nil || c.Server.Bind != "127.0.0.1" {
		t.Fatalf("new installation is not local only: %+v, %v", c.Server, err)
	}
	// Existing listeners must survive reinstallation, including old wildcard binds.
	raw := "server:\n  bind: 0.0.0.0\n  port: 19108\n"
	if err := os.WriteFile(config, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Init(config, env); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(config)
	if err != nil || string(after) != raw {
		t.Fatalf("existing listener was changed: %q, %v", after, err)
	}
}

func TestExampleConfigUsesLoopback(t *testing.T) {
	c, err := LoadConfig("../../../deploy/agent.example.yaml")
	if err != nil || c.Server.Bind != "127.0.0.1" {
		t.Fatalf("example listener is not loopback: %+v, %v", c.Server, err)
	}
}

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

func TestConnectionInfoShowsStoredTokenWithoutQueryingService(t *testing.T) {
	t.Setenv("HOMELAB_AGENT_TOKEN", "")
	dir := t.TempDir()
	config := filepath.Join(dir, "agent.yaml")
	env := filepath.Join(dir, "agent.env")
	token := "stored-connection-test-token-0123456789"
	os.WriteFile(config, []byte("server:\n  bind: 127.0.0.1\n  port: 19108\n"), 0600)
	os.WriteFile(env, []byte("HOMELAB_AGENT_TOKEN="+token+"\n"), 0600)
	c, err := LoadConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err = showConnectionInfo(&out, c, env); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"IP address: 127.0.0.1", "Port:       19108", "Token:      " + token, "Local access only", "Set server.bind to a LAN/VPN IP"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %q in output:\n%s", want, out.String())
		}
	}
	if strings.Contains(out.String(), "installed successfully") {
		t.Fatalf("connection info claims an installation:\n%s", out.String())
	}
}

func TestSMARTConfigRequiresExplicitScopeAndDailyBudget(t *testing.T) {
	for _, raw := range []string{
		"smart: null", "smart: {enabled: 'true'}", "smart: {enabled: true}",
		"smart: {interval_seconds: 60}", "smart: {interval_seconds: .nan}",
		"smart: {interval_seconds: 7776001}", "smart: {serials: [false]}",
		"smart: {serials: ['']}", "smart: {serials: [' TEST']}",
		"smart: {serials: [TEST, TEST]}",
		"disks: {enabled: false}\n  smart: {enabled: true, serials: [TEST]}",
		"interval_seconds: 60\n  smart: {enabled: true, serials: [TEST]}",
	} {
		p := filepath.Join(t.TempDir(), "agent.yaml")
		if err := os.WriteFile(p, []byte("collection:\n  "+raw+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadConfig(p); err == nil {
			t.Fatalf("unsafe config accepted: %s", raw)
		}
	}
	p := filepath.Join(t.TempDir(), "agent.yaml")
	if err := os.WriteFile(p, []byte("collection:\n  smart:\n    enabled: true\n    interval_seconds: 86400\n    serials: [EXAMPLE-HDD-001]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(p)
	if err != nil || !c.Collection.SMART.Enabled || c.Collection.SMART.Serials[0] != "EXAMPLE-HDD-001" {
		t.Fatalf("%+v %v", c.Collection.SMART, err)
	}
	if DefaultConfig().Collection.SMART.Enabled {
		t.Fatal("SMART enabled by default")
	}
}

func TestPowerStateIsConfigurableDiskMetric(t *testing.T) {
	for _, tc := range []struct {
		yaml           string
		enabled, valid bool
	}{
		{"collection:\n  disks:\n    interval_seconds: 60\n", true, true},
		{"collection:\n  disks:\n    power_state: false\n", false, true},
		{"collection:\n  disks:\n    power_state: true\n", true, true},
		{"collection:\n  disks:\n    power_state: 'false'\n", false, false},
	} {
		p := filepath.Join(t.TempDir(), "agent.yaml")
		os.WriteFile(p, []byte(tc.yaml), 0600)
		c, err := LoadConfig(p)
		if (err == nil) != tc.valid {
			t.Fatalf("%q: %v", tc.yaml, err)
		}
		if err == nil && c.Collection.Disks.PowerState != tc.enabled {
			t.Fatalf("%q: %+v", tc.yaml, c.Collection.Disks)
		}
	}
}
