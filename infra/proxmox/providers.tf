# =============================================================================
# Provider config for the Proxmox LXC dev/deploy box.
#
# Schema verified against the bpg/proxmox provider's own docs (not guessed):
# https://github.com/bpg/terraform-provider-proxmox/blob/main/docs/index.md
# https://github.com/bpg/terraform-provider-proxmox/blob/main/docs/resources/virtual_environment_container.md
# https://github.com/bpg/terraform-provider-proxmox/blob/main/docs/resources/virtual_environment_download_file.md
#
# Note the endpoint format: "https://<host>:8006/" — NOT "…/api2/json"
# (the provider appends that path itself; including it is a common mistake).
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = ">= 0.111.0, < 1.0.0"
    }
  }
}

provider "proxmox" {
  endpoint = var.proxmox_api_url
  api_token = var.proxmox_api_token

  # Most home-lab Proxmox installs run on a self-signed cert. If yours has a
  # real cert (e.g. behind your own CA or Let's Encrypt), set this to false
  # in terraform.tfvars.
  insecure = var.proxmox_insecure
}
