#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu droplet. Idempotent — safe to re-run.
#
#     ssh root@<ip> 'bash -s' < bootstrap-droplet.sh
#
# Installs Docker, gives a small droplet enough swap to survive an image build,
# and closes everything except SSH and HTTP(S).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync ufw >/dev/null

# ---------------------------------------------------------------------------
# Docker (official repository — Ubuntu's own package lags and ships no
# compose v2 plugin, which deploy.sh depends on)
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "==> docker"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin >/dev/null
    systemctl enable --now docker
else
    echo "==> docker already installed ($(docker --version))"
fi

# ---------------------------------------------------------------------------
# Swap
# ---------------------------------------------------------------------------
# Composer resolving this dependency graph and Docker unpacking layers both
# spike hard, and Postgres, Redis, FPM and Horizon then sit resident. Swap turns
# an OOM kill into a slow moment, which is the better failure on a test box.
# Override with SWAP_SIZE=8G etc.
SWAP_SIZE="${SWAP_SIZE:-5G}"
TOTAL_MB="$(free -m | awk '/^Mem:/ { print $2 }')"
if swapon --show | grep -q .; then
    echo "==> swap already active: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
else
    echo "==> swap ${SWAP_SIZE} (${TOTAL_MB}MB RAM detected)"
    # fallocate is instant but leaves a sparse file on some filesystems, which
    # swapon refuses; dd is slower and always produces something swappable.
    fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null \
        || dd if=/dev/zero of=/swapfile bs=1M count=$((${SWAP_SIZE%G} * 1024)) status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # 4GB of RAM is enough that the kernel should prefer it and treat swap as
    # a safety net rather than somewhere to page active workers.
    sysctl -qw vm.swappiness=10
    grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi
free -h

# ---------------------------------------------------------------------------
# Firewall
# ---------------------------------------------------------------------------
# SSH is allowed before the firewall is enabled, or enabling it ends this
# session and every future one.
echo "==> firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

mkdir -p /opt/healthy360

echo
echo "==> droplet ready"
echo "    RAM:  ${TOTAL_MB}MB"
echo "    disk: $(df -h / | awk 'NR==2 { print $4 }') free"
echo "    docker compose: $(docker compose version --short 2>/dev/null || echo missing)"
