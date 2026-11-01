# One-time setup for the sheet-music scanner homr (about 150 MB: the package and three model files it downloads from its author's GitHub).
# The helper tries homr first on photos and images and falls back to Audiveris (installed separately) if homr is missing or reads nothing.
# homr is AGPL-3.0 licensed. It is run here as a separate program on your own computer, which is fine; if you ever publish or host this app for
# other people, read its licence first (https://github.com/liebharc/homr).
# Needs Python 3.11 to 3.15. Everything goes under your user folder. Run:  powershell -ExecutionPolicy Bypass -File falling-note-proto\setup_scanner.ps1
$ErrorActionPreference = "Stop"
$venv = Join-Path $env:USERPROFILE ".waterfall-notes\homr-venv"
$py = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Host "Creating the Python environment..."
  New-Item -ItemType Directory -Force (Split-Path $venv) | Out-Null
  python -m venv $venv
}
& $py -m pip install --upgrade pip
& $py -m pip install homr pillow numpy
Write-Host "Downloading homr's models (once)..."
& (Join-Path $venv "Scripts\homr.exe") --init
Write-Host "Done. Restart the helper (python falling-note-proto\scan_server.py); it prints which scanners it found."
