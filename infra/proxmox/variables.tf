# =============================================================================
# Inputs. Copy terraform.tfvars.example to terraform.tfvars and fill in the
# values marked (required) — everything else has a sensible default.
# =============================================================================

variable "proxmox_api_url" {
  description = "Proxmox API endpoint, e.g. https://proxmox.lan:8006/ (required — no /api2/json suffix, the provider adds that itself)"
  type        = string
}

variable "proxmox_api_token" {
  description = "API token in 'user@realm!tokenid=uuid' form (required). Create one under Datacenter > Permissions > API Tokens."
  type        = string
  sensitive   = true
}

variable "proxmox_insecure" {
  description = "Skip TLS verification — true for a self-signed home-lab cert (the common case)."
  type        = bool
  default     = true
}

variable "node_name" {
  description = "The Proxmox node to create the container on, e.g. 'pve' (required)."
  type        = string
}

variable "vm_id" {
  description = "Container ID. Leave null to let Proxmox assign the next free one."
  type        = number
  default     = null
}

variable "hostname" {
  description = "Hostname for the container."
  type        = string
  default     = "mahjong-dev"
}

variable "ssh_public_key" {
  description = "Your SSH public key content (required) — injected as the container's root authorized key."
  type        = string
}

variable "cpu_cores" {
  description = "vCPU cores. The app stack is Next.js + Postgres + NATS in Docker — 4 gives headroom without being wasteful on a home-lab node."
  type        = number
  default     = 4
}

variable "memory_mb" {
  description = "RAM in MB."
  type        = number
  default     = 6144
}

variable "disk_gb" {
  description = "Root filesystem size in GB."
  type        = number
  default     = 24
}

variable "rootfs_datastore_id" {
  description = "Storage for the container's root disk. Common values: 'local-lvm' (default LVM-thin), 'local-zfs' (ZFS pool)."
  type        = string
  default     = "local-lvm"
}

variable "template_datastore_id" {
  description = "Storage to download the LXC template into. Usually 'local'."
  type        = string
  default     = "local"
}

variable "bridge" {
  description = "Network bridge to attach to."
  type        = string
  default     = "vmbr0"
}

variable "mac_address" {
  description = <<-EOT
    Optional fixed MAC for the container's NIC. Leave null to let Proxmox
    auto-assign one (you'd then set your router's DHCP reservation AFTER
    first apply, once you can see the assigned MAC). Set this explicitly if
    you'd rather configure the DHCP reservation BEFORE creating the box —
    any locally-administered address works, e.g. "BC:24:11:AB:CD:EF".
  EOT
  type    = string
  default = null
}

variable "debian_template_version" {
  description = <<-EOT
    Proxmox's official debian-12-standard LXC template version. This drifts
    over time as Proxmox refreshes it — if `apply` 404s on the download,
    check the current filename on your Proxmox host with:
      pveam update && pveam available | grep debian-12
    and update this value to match (e.g. "12.12-1").
  EOT
  type    = string
  default = "12.12-1"
}
