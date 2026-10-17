package agent

type CPU struct {
	Usage *float64 `json:"usage"`
	Cores int      `json:"cores"`
	Model string   `json:"model"`
}
type Memory struct {
	Total   uint64  `json:"total"`
	Used    uint64  `json:"used"`
	Percent float64 `json:"percent"`
}
type Network struct {
	RX         float64  `json:"rx"`
	TX         float64  `json:"tx"`
	Interfaces []string `json:"interfaces"`
}
type GPU struct {
	Name        string             `json:"name"`
	Usage       *float64           `json:"usage"`
	MemoryUsed  *float64           `json:"memory_used"`
	MemoryTotal *float64           `json:"memory_total"`
	Temperature *float64           `json:"temperature"`
	Engines     map[string]float64 `json:"engines,omitempty"`
	Shared      bool               `json:"shared_memory,omitempty"`
}
type Volume struct {
	Mount string `json:"mount"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
}
type Disk struct {
	Serial               string   `json:"serial,omitempty"`
	Firmware             string   `json:"firmware,omitempty"`
	Interface            string   `json:"interface,omitempty"`
	RotationRate         *float64 `json:"rotation_rate,omitempty"`
	PowerState           string   `json:"power_state,omitempty"`
	SMARTState           string   `json:"smart_state,omitempty"`
	SMARTUpdatedAt       *float64 `json:"smart_updated_at,omitempty"`
	UsageUpdatedAt       *float64 `json:"usage_updated_at,omitempty"`
	PowerOnHours         *float64 `json:"power_on_hours,omitempty"`
	PowerCycles          *float64 `json:"power_cycles,omitempty"`
	ReallocatedSectors   *float64 `json:"reallocated_sectors,omitempty"`
	PendingSectors       *float64 `json:"pending_sectors,omitempty"`
	UncorrectableSectors *float64 `json:"uncorrectable_sectors,omitempty"`
	PercentageUsed       *float64 `json:"percentage_used,omitempty"`
	AvailableSpare       *float64 `json:"available_spare,omitempty"`
	MediaErrors          *float64 `json:"media_errors,omitempty"`

	Name         string   `json:"name"`
	Model        string   `json:"model"`
	Type         string   `json:"type"`
	Total        uint64   `json:"total"`
	Used         uint64   `json:"used"`
	MountedTotal uint64   `json:"mounted_total"`
	Health       string   `json:"health"`
	Temperature  *float64 `json:"temperature"`
	Warning      *string  `json:"warning"`
	Volumes      []Volume `json:"volumes"`
}
type Metrics struct {
	Timestamp    float64           `json:"timestamp"`
	Interval     float64           `json:"collection_interval"`
	AgentID      string            `json:"agent_id"`
	AgentVersion string            `json:"agent_version"`
	Hostname     string            `json:"hostname"`
	OS           string            `json:"os"`
	Platform     string            `json:"platform"`
	CPU          CPU               `json:"cpu"`
	Memory       Memory            `json:"memory"`
	Network      Network           `json:"network"`
	Uptime       float64           `json:"uptime"`
	Disks        []Disk            `json:"disks"`
	GPUs         []GPU             `json:"gpus"`
	Diagnostics  map[string]string `json:"diagnostics"`
}

func ptr(v float64) *float64 { return &v }
