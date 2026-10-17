package main

import (
	"fmt"
	"github.com/nikitakiselev/homelab-dashboard/agent/internal/agent"
	"os"
)

func main() {
	if err := agent.CLI(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
