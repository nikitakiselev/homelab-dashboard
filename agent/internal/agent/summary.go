package agent

import (
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Show only addresses the configured listener can accept, rather than the
// automatically selected interfaces used for traffic accounting.
func connectionAddresses(bind string) []string {
	if bind != "" && bind != "0.0.0.0" && bind != "::" {
		return []string{bind}
	}
	result := []string{}
	seen := map[string]bool{}
	interfaces, err := net.Interfaces()
	if err != nil {
		return result
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err != nil || !ip.IsGlobalUnicast() || ip.IsLinkLocalUnicast() {
				continue
			}
			if bind == "0.0.0.0" && ip.To4() == nil {
				continue
			}
			value := ip.String()
			if !seen[value] {
				result = append(result, value)
				seen[value] = true
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := net.ParseIP(result[i]).To4() != nil, net.ParseIP(result[j]).To4() != nil
		if a != b {
			return a
		}
		return result[i] < result[j]
	})
	return result
}

func installationSummary(w io.Writer, version, hostname string, addresses []string, port int, token string) {
	connectionSummary(w, []string{"homelab-agent " + version + " installed successfully", "Service is running · API verified"}, hostname, addresses, port, token)
}
func connectionSummary(w io.Writer, header []string, hostname string, addresses []string, port int, token string) {
	if hostname == "" {
		hostname = "unknown"
	}
	lines := append(header, "", "Hostname:   "+hostname)
	if len(addresses) == 0 {
		lines = append(lines, "IP address: Not detected")
	} else {
		for i, address := range addresses {
			label := "            "
			if i == 0 {
				label = "IP address: "
			}
			lines = append(lines, label+address)
		}
	}
	lines = append(lines, "Port:       "+strconv.Itoa(port), "Token:      "+token, "", "Add this host to your dashboard using the details above.")
	if len(addresses) == 1 {
		if ip := net.ParseIP(addresses[0]); (ip != nil && ip.IsLoopback()) || addresses[0] == "localhost" {
			lines = append(lines, "Local access only. For a remote dashboard:", "Set server.bind to a LAN/VPN IP in /etc/homelab/agent.yaml,", "then run: sudo homelab-agent restart")
		}
	}
	width := 0
	for _, line := range lines {
		width = max(width, utf8.RuneCountInString(line))
	}
	fmt.Fprintln(w, "\n╭"+strings.Repeat("─", width+4)+"╮")
	for _, line := range lines {
		fmt.Fprintf(w, "│  %s%s  │\n", line, strings.Repeat(" ", width-utf8.RuneCountInString(line)))
	}
	fmt.Fprintln(w, "╰"+strings.Repeat("─", width+4)+"╯")
}
func showInstallationSummary(config, env string) error {
	c, err := LoadConfig(config)
	if err != nil {
		return err
	}
	token, err := readToken(env)
	if err != nil {
		return err
	}
	m, err := localMetrics(c, token)
	if err != nil {
		return err
	}
	installationSummary(os.Stdout, m.AgentVersion, m.Hostname, connectionAddresses(c.Server.Bind), c.Server.Port, token)
	return nil
}

// Reads stored credentials only, so the details stay available while the
// service is stopped or failing.
func showConnectionInfo(w io.Writer, c Config, env string) error {
	token, err := readToken(env)
	if err != nil {
		return err
	}
	hostname, _ := os.Hostname()
	connectionSummary(w, []string{"homelab-agent connection details"}, hostname, connectionAddresses(c.Server.Bind), c.Server.Port, token)
	return nil
}
