# =============================================================================
# The dev/deploy LXC. Docker requires a PRIVILEGED container with nesting +
# keyctl enabled — an unprivileged LXC's restrictions fight Docker's overlay
# filesystem. This is the single most common "Docker won't start in my LXC"
# home-lab gotcha, so it's called out here rather than left implicit.
# =============================================================================

resource "proxmox_virtual_environment_download_file" "debian_12_lxc" {
  content_type = "vztmpl"
  datastore_id = var.template_datastore_id
  node_name    = var.node_name
  url          = "http://download.proxmox.com/images/system/debian-12-standard_${var.debian_template_version}_amd64.tar.zst"

  # No checksum pinned: this is Proxmox's own official template mirror (a
  # trusted first-party source), and the version string above already drifts
  # over time — pinning a checksum would just add another thing to keep in
  # sync. Add checksum/checksum_algorithm here if you want strict integrity
  # verification.
}

resource "proxmox_virtual_environment_container" "dev" {
  node_name   = var.node_name
  vm_id       = var.vm_id
  description = "Mahjong Trainer dev/deploy box — managed by Terraform (infra/proxmox). Do not hand-edit in the Proxmox UI; changes will drift from this config."
  tags        = ["terraform", "mahjong-dev"]

  unprivileged = false
  features {
    nesting = true
    keyctl  = true
  }

  cpu {
    cores = var.cpu_cores
  }

  memory {
    dedicated = var.memory_mb
  }

  disk {
    datastore_id = var.rootfs_datastore_id
    size         = var.disk_gb
  }

  network_interface {
    name        = "eth0"
    bridge      = var.bridge
    mac_address = var.mac_address
  }

  initialization {
    hostname = var.hostname

    ip_config {
      ipv4 {
        address = "dhcp"
      }
    }

    user_account {
      keys = [trimspace(var.ssh_public_key)]
    }
  }

  operating_system {
    template_file_id = proxmox_virtual_environment_download_file.debian_12_lxc.id
    type             = "debian"
  }

  started       = true
  start_on_boot = true
}
