# Initialise the local Garage S3 service: single-node layout, dev access key,
# and the healthy360-local bucket. Idempotent - safe to re-run.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$AccessKey = "GK0123456789abcdef01234567"
$SecretKey = "7d6c5b4a3928170605f4e3d2c1b0a9887766554433221100ffeeddccbbaa9988"
$KeyName = "healthy360-dev"
$Bucket = "healthy360-local"

$status = docker compose exec -T garage /garage status
if ($LASTEXITCODE -ne 0) { throw "storage-init: garage status failed" }

if ($status -match "NO ROLE ASSIGNED") {
    $nodeId = ($status -split "`n" | ForEach-Object { ($_ -split "\s+")[0] } |
        Where-Object { $_ -match "^[0-9a-f]{10,}$" } | Select-Object -First 1)
    if (-not $nodeId) { throw "storage-init: could not determine Garage node id" }
    Write-Host "storage-init: assigning layout to node $nodeId"
    docker compose exec -T garage /garage layout assign -z dc1 -c 5G $nodeId
    docker compose exec -T garage /garage layout apply --version 1
} else {
    Write-Host "storage-init: layout already assigned"
}

$keys = docker compose exec -T garage /garage key list
if ($keys -match $KeyName) {
    Write-Host "storage-init: key $KeyName already exists"
} else {
    Write-Host "storage-init: importing dev key $KeyName"
    docker compose exec -T garage /garage key import --yes -n $KeyName $AccessKey $SecretKey
}

$buckets = docker compose exec -T garage /garage bucket list
if ($buckets -match $Bucket) {
    Write-Host "storage-init: bucket $Bucket already exists"
} else {
    Write-Host "storage-init: creating bucket $Bucket"
    docker compose exec -T garage /garage bucket create $Bucket
}

docker compose exec -T garage /garage bucket allow --read --write --owner $Bucket --key $KeyName | Out-Null
Write-Host "storage-init: bucket $Bucket ready (key $KeyName)"
