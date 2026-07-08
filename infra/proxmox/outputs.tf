output "vm_id" {
  description = "The container's Proxmox VMID."
  value       = proxmox_virtual_environment_container.dev.vm_id
}

output "next_steps" {
  value = <<-EOT
    Container '${var.hostname}' created (VMID ${proxmox_virtual_environment_container.dev.vm_id}).

    1. Find its IP — on the Proxmox host:
         pct exec ${proxmox_virtual_environment_container.dev.vm_id} -- ip -4 addr show eth0
       (or check the Proxmox UI: node > CT ${proxmox_virtual_environment_container.dev.vm_id} > Summary)

    2. Reserve a DHCP lease for it in your router using its MAC address
       (Proxmox UI > CT > Hardware > Network Device shows the MAC if you
       didn't pin one via var.mac_address).

    3. SSH in and run the bootstrap script:
         ssh root@<ip> 'bash -s' < infra/proxmox/bootstrap.sh

    4. Fill in real secrets in /opt/mahjong-trainer/.env on the box (see
       .env.example in the repo for what's needed), then:
         cd /opt/mahjong-trainer && docker compose up -d
  EOT
}
