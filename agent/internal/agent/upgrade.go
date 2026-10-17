package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
func Upgrade(version, config, env string) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return fmt.Errorf("upgrade requires root on Linux")
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return fmt.Errorf("unsupported architecture")
	}
	if version != "latest" && (!strings.HasPrefix(version, "agent-v") || strings.ContainsAny(version, "/\\?% \r\n")) {
		return fmt.Errorf("expected release tag agent-vX.Y.Z")
	}
	dir, err := os.MkdirTemp("", "homelab-agent-upgrade-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	asset := "homelab-agent_linux_" + runtime.GOARCH
	base := releaseBase + "/latest/download/"
	if version != "latest" {
		base = releaseBase + "/download/" + version + "/"
	}
	if err = download(base+"SHA256SUMS", dir+"/SHA256SUMS", 65536); err != nil {
		return err
	}
	if err = download(base+asset, dir+"/"+asset, 100<<20); err != nil {
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
	return Install(dir+"/"+asset, config, env)
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
	fmt.Printf("homelab-agent %s installed; API verified on port %d\nConfig, credentials and history preserved.\n", expected, c.Server.Port)
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
