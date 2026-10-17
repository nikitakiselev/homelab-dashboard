package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const releaseBase = "https://github.com/nikitakiselev/homelab-dashboard/releases"

func download(url, path string, limit int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if r.URL.Scheme != "https" || len(via) > 8 {
			return fmt.Errorf("invalid download redirect")
		}
		return nil
	}}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download HTTP %d", resp.StatusCode)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, err := io.Copy(file, io.LimitReader(resp.Body, limit+1))
	e := file.Close()
	if n > limit {
		return fmt.Errorf("download exceeds size limit")
	}
	if err != nil {
		return err
	}
	return e
}

type upgradeActions struct {
	fetch         func(string, string, int64) error
	binaryVersion func(string) (string, error)
	install       func(string, string, string) error
	output        io.Writer
}

var releaseTagPattern = regexp.MustCompile(`^agent-v[0-9][a-zA-Z0-9._+-]*$`)

const latestReleaseAPI = "https://api.github.com/repos/nikitakiselev/homelab-dashboard/releases?per_page=100&page=1"

func Upgrade(version, config, env string) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return fmt.Errorf("upgrade requires root on Linux")
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return fmt.Errorf("unsupported architecture")
	}
	return performUpgrade(version, Version, runtime.GOARCH, config, env, upgradeActions{
		fetch: download, install: Install, output: os.Stdout,
		binaryVersion: func(path string) (string, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			out, err := exec.CommandContext(ctx, path, "version").Output()
			return strings.TrimSpace(string(out)), err
		},
	})
}

func performUpgrade(version, currentVersion, arch, config, env string, actions upgradeActions) error {
	if version != "latest" && !releaseTagPattern.MatchString(version) {
		return fmt.Errorf("expected release tag agent-vX.Y.Z")
	}
	fmt.Fprintf(actions.output, "Current version: %s\n", currentVersion)

	dir, err := os.MkdirTemp("", "homelab-agent-upgrade-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	tag := version
	if tag == "latest" {
		tag, err = latestAgentRelease(dir, actions.fetch)
		if err != nil {
			return err
		}
	}
	targetVersion := strings.TrimPrefix(tag, "agent-v")
	fmt.Fprintf(actions.output, "Available version: %s\n", targetVersion)
	if currentVersion == targetVersion {
		fmt.Fprintf(actions.output, "Already up to date (%s). No changes made; service was not restarted.\n", currentVersion)
		return nil
	}
	asset := "homelab-agent_linux_" + arch
	// Pin both files to the resolved tag so a concurrent release cannot mix them.
	base := releaseBase + "/download/" + tag + "/"
	fmt.Fprintf(actions.output, "Updating agent: %s -> %s\n", currentVersion, targetVersion)
	if err = actions.fetch(base+"SHA256SUMS", dir+"/SHA256SUMS", 65536); err != nil {
		return err
	}
	if err = actions.fetch(base+asset, dir+"/"+asset, 100<<20); err != nil {
		return err
	}

	raw, err := os.ReadFile(dir + "/SHA256SUMS")
	if err != nil {
		return err
	}
	sum := ""
	for _, line := range strings.Split(string(raw), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == asset {
			if sum != "" {
				return fmt.Errorf("duplicate checksum")
			}
			sum = f[0]
		}
	}
	if len(sum) != 64 {
		return fmt.Errorf("release checksum not found")
	}
	f, err := os.Open(dir + "/" + asset)
	if err != nil {
		return err
	}
	hash := sha256.New()
	_, err = io.Copy(hash, f)
	f.Close()
	if err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != sum {
		return fmt.Errorf("binary checksum mismatch")
	}
	if err = os.Chmod(dir+"/"+asset, 0755); err != nil {
		return err
	}
	actualVersion, err := actions.binaryVersion(dir + "/" + asset)
	if err != nil {
		return fmt.Errorf("cannot read downloaded agent version: %w", err)
	}
	if actualVersion != "homelab-agent "+targetVersion {
		return fmt.Errorf("downloaded binary version does not match release %s", tag)
	}
	if err = actions.install(dir+"/"+asset, config, env); err != nil {
		return err
	}
	fmt.Fprintf(actions.output, "Agent updated: %s -> %s. Service restarted and API verified; configuration and history preserved.\n", currentVersion, targetVersion)
	return nil
}
func Install(source, config, env string) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return fmt.Errorf("installation requires root on Linux")
	}
	for _, path := range []string{config, env} {
		if !filepath.IsAbs(path) || strings.ContainsAny(path, " \t\r\n\"\\") {
			return fmt.Errorf("invalid configuration path")
		}
	}
	lock, err := os.OpenFile("/run/homelab-agent-install.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("another agent installation is running")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if err = Init(config, env); err != nil {
		return err
	}
	c, err := LoadConfig(config)
	if err != nil {
		return err
	}
	token, err := readToken(env)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(c.History.Path), 0700); err != nil {
		return err
	}
	target := "/usr/local/bin/homelab-agent"
	if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	out, err := exec.Command(source, "version").Output()
	if err != nil || !strings.HasPrefix(string(out), "homelab-agent ") {
		return fmt.Errorf("invalid executable")
	}
	expected := strings.TrimSpace(strings.TrimPrefix(string(out), "homelab-agent "))
	next := target + ".next"
	os.Remove(next)
	if err = copyFile(source, next, 0755); err != nil {
		return err
	}
	defer os.Remove(next)
	unitPath := "/etc/systemd/system/homelab-agent.service"
	oldUnit, unitErr := os.ReadFile(unitPath)
	if unitErr != nil && !os.IsNotExist(unitErr) {
		return unitErr
	}
	active := exec.Command("systemctl", "is-active", "--quiet", "homelab-agent").Run() == nil
	existed := existsFile(target)
	previous := target + ".previous"
	os.Remove(previous)
	if existed {
		if err = copyFile(target, previous, 0755); err != nil {
			return err
		}
	}
	if active {
		if err = systemctl("stop"); err != nil {
			return err
		}
	}
	rollback := func(cause error) error {
		_ = systemctl("stop")
		if existed {
			_ = os.Rename(previous, target)
		} else {
			_ = os.Remove(target)
		}
		if unitErr == nil {
			_ = os.WriteFile(unitPath, oldUnit, 0644)
		} else {
			_ = os.Remove(unitPath)
		}
		_ = interactive("systemctl", "daemon-reload")
		if active {
			_ = systemctl("start")
		}
		return fmt.Errorf("update failed; previous binary and service restored: %w", cause)
	}
	if err = os.Rename(next, target); err != nil {
		return rollback(err)
	}
	unit := fmt.Sprintf(`[Unit]
Description=Homelab Linux metrics agent
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
EnvironmentFile=%s
ExecStart=/usr/local/bin/homelab-agent run --config "%s" --env "%s"
Restart=on-failure
RestartSec=5
StateDirectory=homelab-agent
StateDirectoryMode=0700
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths="%s"
ProtectHome=true
PrivateTmp=true
UMask=0077
[Install]
WantedBy=multi-user.target
`, env, config, env, filepath.Dir(c.History.Path))
	if err = os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
		return rollback(err)
	}
	if err = interactive("systemctl", "daemon-reload"); err != nil {
		return rollback(err)
	}
	if err = systemctl("restart"); err != nil {
		return rollback(err)
	}
	healthy := false
	deadline := time.Now().Add(40 * time.Second)
	for time.Now().Before(deadline) {
		m, e := localMetrics(c, token)
		if e == nil && m.AgentVersion == expected && m.AgentID != "" {
			healthy = true
			break
		}
		time.Sleep(time.Second)
	}
	if !healthy {
		return rollback(fmt.Errorf("new agent did not pass API health check"))
	}
	if err = interactive("systemctl", "enable", "homelab-agent"); err != nil {
		return rollback(err)
	}
	return nil
}
func copyFile(source, dest string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	e := out.Close()
	if err != nil {
		return err
	}
	return e
}

// Dashboard releases share the repository, never the agent version channel.
func latestAgentRelease(dir string, fetch func(string, string, int64) error) (string, error) {
	stable := regexp.MustCompile(`^agent-v([0-9]+)\.([0-9]+)\.([0-9]+)$`)
	var best [3]int64
	selected := ""
	for page := 1; page <= 10; page++ {
		url := strings.TrimSuffix(latestReleaseAPI, "1") + strconv.Itoa(page)
		path := dir + "/release.json"
		if err := fetch(url, path, 4<<20); err != nil {
			return "", fmt.Errorf("cannot check agent releases: %w", err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		var releases []struct {
			Tag        string `json:"tag_name"`
			Draft      bool   `json:"draft"`
			Prerelease bool   `json:"prerelease"`
		}
		if err = json.Unmarshal(raw, &releases); err != nil {
			return "", fmt.Errorf("invalid release list: %w", err)
		}
		for _, release := range releases {
			parts := stable.FindStringSubmatch(release.Tag)
			if parts == nil || release.Draft || release.Prerelease {
				continue
			}
			var version [3]int64
			valid := true
			for i := range version {
				version[i], err = strconv.ParseInt(parts[i+1], 10, 64)
				if err != nil {
					valid = false
				}
			}
			if !valid {
				continue
			}
			greater := selected == ""
			for i := range version {
				if version[i] != best[i] {
					greater = version[i] > best[i]
					break
				}
			}
			if greater {
				best, selected = version, release.Tag
			}
		}
		if len(releases) < 100 {
			if selected == "" {
				return "", fmt.Errorf("no published stable agent release found")
			}
			return selected, nil
		}
	}
	return "", fmt.Errorf("too many releases; specify --version agent-vX.Y.Z")
}
