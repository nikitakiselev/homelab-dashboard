package agent

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestUpgradeAlreadyCurrentDoesNotDownloadOrInstall(t *testing.T) {
	for _, target := range []string{"latest", "agent-v0.3.1"} {
		t.Run(target, func(t *testing.T) {
			var output bytes.Buffer
			calls := 0
			actions := upgradeActions{
				output: &output,
				fetch: func(url, path string, limit int64) error {
					calls++
					if url != latestReleaseAPI {
						t.Fatalf("unnecessary binary download: %s", url)
					}
					return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.1"}]`), 0600)
				},
				binaryVersion: func(string) (string, error) { t.Fatal("unnecessary executable run"); return "", nil },
				install:       func(string, string, string) error { t.Fatal("same-version update changed installation"); return nil },
			}
			if err := performUpgrade(target, "0.3.1", "amd64", "/fixture/config", "/fixture/env", actions); err != nil {
				t.Fatal(err)
			}
			if (target == "latest" && calls != 1) || (target != "latest" && calls != 0) {
				t.Fatalf("unexpected requests: %d", calls)
			}
			for _, text := range []string{"Current version: 0.3.1", "Available version: 0.3.1", "Already up to date", "service was not restarted"} {
				if !strings.Contains(output.String(), text) {
					t.Fatalf("missing %q in %s", text, &output)
				}
			}
		})
	}
}

func TestUpgradePinsReleaseVerifiesAndReportsChange(t *testing.T) {
	for _, target := range []string{"latest", "agent-v0.3.2", "agent-v0.2.0"} {
		t.Run(target, func(t *testing.T) {
			var output bytes.Buffer
			expected := "0.3.2"
			if target == "agent-v0.2.0" {
				expected = "0.2.0"
			}
			payload := []byte("verified fixture binary")
			asset := "homelab-agent_linux_arm64"
			downloads := []string{}
			installed := false
			actions := upgradeActions{output: &output,
				fetch: func(url, path string, limit int64) error {
					downloads = append(downloads, url)
					switch url {
					case latestReleaseAPI:
						return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.2"}]`), 0600)
					case releaseBase + "/download/agent-v" + expected + "/SHA256SUMS":
						return os.WriteFile(path, []byte(fmt.Sprintf("%x  %s\n", sha256.Sum256(payload), asset)), 0600)
					case releaseBase + "/download/agent-v" + expected + "/" + asset:
						return os.WriteFile(path, payload, 0600)
					default:
						t.Fatalf("unpinned or unexpected download: %s", url)
						return nil
					}
				},
				binaryVersion: func(path string) (string, error) { return "homelab-agent " + expected, nil },
				install: func(path, config, env string) error {
					raw, err := os.ReadFile(path)
					if err != nil || !bytes.Equal(raw, payload) || config != "/fixture/config" || env != "/fixture/env" {
						t.Fatalf("incorrect install: %v", err)
					}
					installed = true
					return nil
				},
			}
			if err := performUpgrade(target, "0.3.1", "arm64", "/fixture/config", "/fixture/env", actions); err != nil {
				t.Fatal(err)
			}
			if !installed || !strings.Contains(output.String(), "Agent updated: 0.3.1 -> "+expected) {
				t.Fatalf("missing success report: %s", &output)
			}
			expectedDownloads := 2
			if target == "latest" {
				expectedDownloads = 3
			}
			if len(downloads) != expectedDownloads {
				t.Fatalf("incorrect downloads: %v", downloads)
			}
		})
	}
}

func TestUpgradeFailuresNeverTouchInstalledAgent(t *testing.T) {
	for _, kind := range []string{"api", "json", "tag", "draft", "prerelease", "checksum", "duplicate-checksum", "wrong-binary-version", "binary-execution", "install"} {
		t.Run(kind, func(t *testing.T) {
			var output bytes.Buffer
			payload := []byte("fixture")
			installed := false
			actions := upgradeActions{output: &output,
				fetch: func(url, path string, limit int64) error {
					if url == latestReleaseAPI {
						switch kind {
						case "api":
							return fmt.Errorf("download HTTP 403")
						case "json":
							return os.WriteFile(path, []byte("invalid"), 0600)
						case "tag":
							return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.2/../../other"}]`), 0600)
						case "draft":
							return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.2","draft":true}]`), 0600)
						case "prerelease":
							return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.2","prerelease":true}]`), 0600)
						}
						return os.WriteFile(path, []byte(`[{"tag_name":"agent-v0.3.2"}]`), 0600)
					}
					if strings.HasSuffix(url, "SHA256SUMS") {
						line := fmt.Sprintf("%x  homelab-agent_linux_amd64\n", sha256.Sum256(payload))
						if kind == "duplicate-checksum" {
							line += line
						}
						return os.WriteFile(path, []byte(line), 0600)
					}
					if kind == "checksum" {
						payload = []byte("tampered")
					}
					return os.WriteFile(path, payload, 0600)
				},
				binaryVersion: func(string) (string, error) {
					if kind == "checksum" || kind == "duplicate-checksum" {
						t.Fatal("unverified executable invoked")
					}
					if kind == "wrong-binary-version" {
						return "homelab-agent 0.3.0", nil
					}
					if kind == "binary-execution" {
						return "", fmt.Errorf("exec failed")
					}
					return "homelab-agent 0.3.2", nil
				},
				install: func(string, string, string) error {
					installed = true
					return fmt.Errorf("install failed; previous version restored")
				},
			}
			err := performUpgrade("latest", "0.3.1", "amd64", "/fixture/config", "/fixture/env", actions)
			if err == nil {
				t.Fatal("failure accepted")
			}
			if installed && kind != "install" {
				t.Fatal("installation touched before verification")
			}
			if strings.Contains(output.String(), "Agent updated:") || strings.Contains(output.String(), "Already up to date") {
				t.Fatalf("failure reported as success: %s", &output)
			}
		})
	}
}

func TestUpgradeRejectsInvalidTagBeforeNetwork(t *testing.T) {
	for _, tag := range []string{"", "main", "agent-v", "agent-v0.3.1/other", "agent-v0.3.1?x=1", "agent-v0.3.1\n"} {
		actions := upgradeActions{output: &bytes.Buffer{}, fetch: func(string, string, int64) error { t.Fatal("invalid tag fetched"); return nil }}
		if err := performUpgrade(tag, "0.3.1", "amd64", "config", "env", actions); err == nil {
			t.Fatalf("invalid tag accepted: %q", tag)
		}
	}
}

func TestAgentReleaseChannelIgnoresDashboardAndDrafts(t *testing.T) {
	tag, err := latestAgentRelease(t.TempDir(), func(url, path string, limit int64) error {
		return os.WriteFile(path, []byte(`[{"tag_name":"dashboard-v99.0.0"},{"tag_name":"agent-v0.2.0"},{"tag_name":"agent-v0.3.0"},{"tag_name":"agent-v0.4.0","draft":true},{"tag_name":"agent-v0.5.0","prerelease":true}]`), 0600)
	})
	if err != nil || tag != "agent-v0.3.0" {
		t.Fatalf("%s %v", tag, err)
	}
}
