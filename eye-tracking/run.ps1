# Start the gaze service, creating the venv and installing deps on first run.
#
#   .\run.ps1              headless
#   .\run.ps1 -Preview     with the debug window
#   .\run.ps1 -Camera 1    pick a different webcam
param(
    [switch]$Preview,
    [int]$Camera = 0,
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    # MediaPipe has no wheels for Python 3.13+, so prefer an interpreter it supports.
    $base = $null
    foreach ($v in @("3.12", "3.11", "3.10")) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            & py "-$v" --version *> $null
            if ($LASTEXITCODE -eq 0) { $base = @("py", "-$v"); break }
        }
    }
    if ($null -eq $base) { $base = @("python") }

    & $base[0] $base[1..($base.Length - 1)] -m venv .venv
    Write-Host "Installing dependencies (this takes a few minutes the first time)..." -ForegroundColor Cyan
    & $python -m pip install --upgrade pip --quiet
    & $python -m pip install -r requirements.txt
}

$serverArgs = @("server.py", "--camera", $Camera, "--port", $Port)
if ($Preview) { $serverArgs += "--preview" }

Write-Host "Starting gaze service on ws://127.0.0.1:$Port" -ForegroundColor Green
& $python @serverArgs
