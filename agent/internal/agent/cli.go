package agent

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"go.yaml.in/yaml/v3"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const help = `homelab-agent — Linux server metrics

Usage: homelab-agent <command> [options]
  version       Show agent version
  init          Create YAML and token without overwriting existing files
  run           Run the collector and authenticated HTTP API
  status        Show systemd state and check the local API
  start         Start the installed service
  restart       Restart the installed service
  stop          Stop the installed service
  logs          Show service logs (add --follow for live output)
  check-config  Validate YAML without starting the agent
  doctor        Check platform, configuration and hardware utilities
  upgrade       Download, verify and activate the latest release; roll back on failure

Common options: --config /etc/homelab/agent.yaml --env /etc/homelab/agent.env
Run options: --bind ADDRESS --port PORT --data SQLITE_PATH
Upgrade options: --version agent-vX.Y.Z
`

func CLI(args []string) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "help" || args[0] == "-h" {
		fmt.Print(help)
		return nil
	}
	if args[0] == "version" || args[0] == "--version" {
		if len(args) > 1 {
			return fmt.Errorf("version takes no options")
		}
		fmt.Println("homelab-agent " + Version)
		return nil
	}
	cmd := args[0]
	fs := flag.NewFlagSet("homelab-agent "+cmd, flag.ContinueOnError)
	config := fs.String("config", "/etc/homelab/agent.yaml", "YAML configuration")
	env := fs.String("env", "/etc/homelab/agent.env", "Credentials file")
	bind, data, version, binary := new(string), new(string), new(string), new(string)
	port, follow := new(int), new(bool)
	*version = "latest"
	switch cmd {
	case "run":
		fs.StringVar(bind, "bind", "", "Override listening address")
		fs.IntVar(port, "port", 0, "Override listening port")
		fs.StringVar(data, "data", "", "Override history path")
	case "logs":
		fs.BoolVar(follow, "follow", false, "Follow service logs")
	case "upgrade":
		fs.StringVar(version, "version", "latest", "Release tag")
	case "install":
		fs.StringVar(binary, "binary", "", "Binary path for installation")
	}
	if err := fs.Parse(args[1:]); err != nil {
		if err == flag.ErrHelp {
			return nil
		}
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
	}
	switch cmd {
	case "start", "restart", "stop":
		return systemctl(cmd)
	case "logs":
		a := []string{"-u", "homelab-agent", "-n", "100", "--no-pager"}
		if *follow {
			a = append(a, "--follow")
		}
		return interactive("journalctl", a...)
	case "init":
		return Init(*config, *env)
	case "install":
		if *binary == "" {
			return fmt.Errorf("install requires --binary")
		}
		if err := Install(*binary, *config, *env); err != nil {
			return err
		}
		return showInstallationSummary(*config, *env)
	case "upgrade":
		return Upgrade(*version, *config, *env)
	case "run", "check-config", "status", "doctor":
	default:
		return fmt.Errorf("unknown command %q; use homelab-agent --help", cmd)
	}
	configPath := *config
	if cmd == "run" && !existsFile(configPath) && configPath == "/etc/homelab/agent.yaml" {
		configPath = ""
	}
	c, err := LoadConfig(configPath)
	if err != nil {
		return err
	}
	if *bind != "" {
		c.Server.Bind = *bind
	}
	portSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "port" {
			portSet = true
		}
	})
	if portSet {
		c.Server.Port = *port
	}
	if *data != "" {
		c.History.Path = *data
	}
	if err = c.Validate(); err != nil {
		return err
	}
	switch cmd {
	case "check-config":
		raw, _ := yaml.Marshal(c)
		fmt.Print(string(raw))
		return nil
	case "doctor":
		fmt.Printf("History database: %s\nATA SMART: enabled=%t, interval=%.0fs, allowed serials=%d\nATA policy: observed I/O, CHECK POWER MODE, guarded read; no USB/SAS autodetection\nHistory storage: use an SSD to avoid keeping an HDD awake with database writes\n", c.History.Path, c.Collection.SMART.Enabled, c.Collection.SMART.Interval, len(c.Collection.SMART.Serials))
		fmt.Printf("Platform: %s/%s\nConfig: OK\nPort: %s:%d\n", runtime.GOOS, runtime.GOARCH, c.Server.Bind, c.Server.Port)
		for _, name := range []string{"systemctl", "lsblk", "smartctl", "hdparm", "nvidia-smi", "intel_gpu_top"} {
			path, err := exec.LookPath(name)
			if err != nil {
				path = "not found"
			}
			fmt.Printf("%s: %s\n", name, path)
		}
		if runtime.GOOS != "linux" {
			return fmt.Errorf("agent requires Linux")
		}
		return nil
	case "status":
		state, _ := exec.Command("systemctl", "is-active", "homelab-agent").Output()
		fmt.Printf("Version: %s\nService: %s\n", Version, strings.TrimSpace(string(state)))
		token, err := readToken(*env)
		if err != nil {
			return err
		}
		m, err := localMetrics(c, token)
		if err != nil {
			return fmt.Errorf("API unavailable: %w", err)
		}
		fmt.Printf("API: OK\nRunning version: %s\nHost: %s\nPort: %d\n", m.AgentVersion, m.Hostname, c.Server.Port)
		return nil
	default:
		token, err := readToken(*env)
		if err != nil {
			return err
		}
		return Serve(c, token)
	}
}
func existsFile(path string) bool { _, err := os.Stat(path); return err == nil }
func interactive(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
func systemctl(action string) error { return interactive("systemctl", action, "homelab-agent") }
func credentials(path string) (map[string]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok {
			values[k] = v
		}
	}
	return values, nil
}
func readToken(env string) (string, error) {
	token := os.Getenv("HOMELAB_AGENT_TOKEN")
	if token == "" {
		v, err := credentials(env)
		if err != nil {
			return "", fmt.Errorf("cannot read credentials; run homelab-agent init or provide HOMELAB_AGENT_TOKEN: %w", err)
		}
		token = v["HOMELAB_AGENT_TOKEN"]
	}
	if len(token) < 24 || len(token) > 256 || strings.ContainsAny(token, " \r\n\t") {
		return "", fmt.Errorf("invalid agent token")
	}
	for _, c := range token {
		if c > 127 {
			return "", fmt.Errorf("invalid agent token")
		}
	}
	return token, nil
}
func Init(config, env string) error {
	if err := os.MkdirAll(filepath.Dir(env), 0750); err != nil {
		return err
	}
	if !existsFile(env) {
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			return err
		}
		token := base64.RawURLEncoding.EncodeToString(random)
		if err := writeNew(env, []byte("HOMELAB_AGENT_TOKEN="+token+"\n"), 0600); err != nil {
			return err
		}
	}
	if !existsFile(config) {
		c := DefaultConfig()
		if values, err := credentials(env); err == nil {
			if p := values["HOMELAB_AGENT_PORT"]; p != "" {
				n, err := strconv.Atoi(p)
				if err != nil {
					return fmt.Errorf("invalid legacy port")
				}
				c.Server.Port = n
			}
			if v := values["HOMELAB_INTERFACES"]; v != "" {
				c.Network.Interfaces = strings.Split(v, ",")
			}
		}
		if err := c.Validate(); err != nil {
			return err
		}
		raw, _ := yaml.Marshal(c)
		if err := os.MkdirAll(filepath.Dir(config), 0750); err != nil {
			return err
		}
		if err := writeNew(config, raw, 0640); err != nil {
			return err
		}
	}
	if _, err := LoadConfig(config); err != nil {
		return err
	}
	if _, err := readToken(env); err != nil {
		return err
	}
	fmt.Printf("Config: %s\nCredentials: %s (existing files preserved)\n", config, env)
	return nil
}
func writeNew(path string, data []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func localMetrics(c Config, token string) (Metrics, error) {
	host := c.Server.Bind
	if host == "0.0.0.0" || host == "" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	req, _ := http.NewRequest("GET", "http://"+net.JoinHostPort(host, strconv.Itoa(c.Server.Port))+"/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return Metrics{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return Metrics{}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var m Metrics
	err = json.NewDecoder(io.LimitReader(resp.Body, 2_000_000)).Decode(&m)
	return m, err
}
