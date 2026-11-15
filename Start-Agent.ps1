param([int]$Port = 3001, [string]$DataDirectory = '.carmeleon-private')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:CARMELEON_AGENT_PORT = [string]$Port
$env:CARMELEON_AGENT_DATA_DIR = $DataDirectory
$bun = Get-Command bun -ErrorAction Stop
& $bun.Source run server/agent-server.ts
exit $LASTEXITCODE
