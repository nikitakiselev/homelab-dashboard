package agent

import (
	"bytes"
	"fmt"
	"go.yaml.in/yaml/v3"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

type ProbeConfig struct {
	Enabled  bool    `yaml:"enabled"`
	Interval float64 `yaml:"interval_seconds"`
}
type Config struct {
	Server struct {
		Bind string `yaml:"bind"`
		Port int    `yaml:"port"`
	} `yaml:"server"`
	Collection struct {
		Interval float64     `yaml:"interval_seconds"`
		Disks    ProbeConfig `yaml:"disks"`
		GPU      ProbeConfig `yaml:"gpu"`
	} `yaml:"collection"`
	Network struct {
		Interfaces []string `yaml:"interfaces"`
	} `yaml:"network"`
	History struct {
		Days int    `yaml:"retention_days"`
		Path string `yaml:"path"`
	} `yaml:"history"`
}

func DefaultConfig() Config {
	var c Config
	c.Server.Bind = "0.0.0.0"
	c.Server.Port = 9108
	c.Collection.Interval = 5
	c.Collection.Disks = ProbeConfig{true, 60}
	c.Collection.GPU = ProbeConfig{true, 5}
	c.Network.Interfaces = []string{}
	c.History.Days = 90
	c.History.Path = "/var/lib/homelab-agent/agent.sqlite"
	return c
}
func LoadConfig(path string) (Config, error) {
	c := DefaultConfig()
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return c, err
		}
		defer f.Close()
		raw, err := io.ReadAll(io.LimitReader(f, 65537))
		if err != nil {
			return c, err
		}
		if len(raw) > 65536 {
			return c, fmt.Errorf("config must be smaller than 64 KiB")
		}
		// Validate scalar tags as well as fields: YAML strings must not silently become numbers or booleans.
		var node yaml.Node
		if err = yaml.Unmarshal(raw, &node); err != nil {
			return c, err
		}
		if err = validateNode(&node, ""); err != nil {
			return c, err
		}
		dec := yaml.NewDecoder(bytes.NewReader(raw))
		dec.KnownFields(true)
		if err = dec.Decode(&c); err != nil && err != io.EOF {
			return c, err
		}
		var extra any
		if err = dec.Decode(&extra); err != io.EOF {
			return c, fmt.Errorf("config must contain exactly one YAML document")
		}
		if !filepath.IsAbs(c.History.Path) {
			c.History.Path = filepath.Join(filepath.Dir(path), c.History.Path)
		}
	}
	if err := c.Validate(); err != nil {
		return c, err
	}
	return c, nil
}
func validateNode(n *yaml.Node, path string) error {
	if n.Kind == yaml.AliasNode {
		return fmt.Errorf("YAML aliases are not supported")
	}
	if n.Kind == yaml.MappingNode {
		seen := map[string]bool{}
		for i := 0; i < len(n.Content); i += 2 {
			k, v := n.Content[i], n.Content[i+1]
			if k.Tag != "!!str" || seen[k.Value] {
				return fmt.Errorf("invalid or duplicate key: %s", k.Value)
			}
			seen[k.Value] = true
			next := strings.TrimPrefix(path+"."+k.Value, ".")
			tag := ""
			switch next {
			case "server.bind", "history.path":
				tag = "!!str"
			case "server.port", "history.retention_days":
				tag = "!!int"
			case "collection.disks.enabled", "collection.gpu.enabled":
				tag = "!!bool"
			}
			if tag != "" && v.Tag != tag {
				return fmt.Errorf("%s: invalid value type", next)
			}
			if strings.HasSuffix(next, "interval_seconds") && v.Tag != "!!int" && v.Tag != "!!float" {
				return fmt.Errorf("%s: expected number", next)
			}
			if (next == "server" || next == "collection" || next == "collection.disks" || next == "collection.gpu" || next == "network" || next == "history") && v.Kind != yaml.MappingNode {
				return fmt.Errorf("%s: expected mapping", next)
			}
			if next == "network.interfaces" {
				if v.Kind != yaml.SequenceNode {
					return fmt.Errorf("interfaces: expected list")
				}
				for _, s := range v.Content {
					if s.Tag != "!!str" {
						return fmt.Errorf("interfaces: expected strings")
					}
				}
			}
			if err := validateNode(v, next); err != nil {
				return err
			}
		}
	} else {
		for _, v := range n.Content {
			if err := validateNode(v, path); err != nil {
				return err
			}
		}
	}
	return nil
}
func (c Config) Validate() error {
	if strings.TrimSpace(c.Server.Bind) == "" || c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid server address or port")
	}
	for _, v := range []struct {
		n      string
		v, max float64
	}{{"collection.interval_seconds", c.Collection.Interval, 300}, {"disks.interval_seconds", c.Collection.Disks.Interval, 86400}, {"gpu.interval_seconds", c.Collection.GPU.Interval, 86400}} {
		if math.IsNaN(v.v) || math.IsInf(v.v, 0) || v.v < 1 || v.v > v.max {
			return fmt.Errorf("%s must be between 1 and %g", v.n, v.max)
		}
	}
	if c.History.Days < 1 || c.History.Days > 3650 || c.History.Path == "" {
		return fmt.Errorf("invalid history settings")
	}
	for _, n := range c.Network.Interfaces {
		if n == "" || strings.ContainsAny(n, " \t\r\n/") {
			return fmt.Errorf("invalid network interface")
		}
	}
	return nil
}
