//go:build !linux

package agent

import (
	"context"
	"fmt"
)

type Collector struct{ ID string }

func NewCollector(Config, *History) (*Collector, error) {
	return nil, fmt.Errorf("agent requires Linux")
}
func (*Collector) Snapshot() *Metrics  { return nil }
func (*Collector) Run(context.Context) {}
func setHistory(*Collector, *History)  {}
