# One-time setup for "Split instruments" (song -> vocals, drums, bass, guitar, piano, everything else).
#   Demucs (fast, about 0.6x the song's length on a processor) is always installed; with -Best the BS-RoFormer model is added (about 700 MB, much
#   cleaner piano, but about 10x the song's length on a processor, so only worth it with a graphics card).
# It gets its own Python environment under your user folder (the piano and scanner environments are not touched). With an NVIDIA graphics card it installs
# the CUDA build of PyTorch (about 2.5 GB); without one, the processor build.
# Licences: the Demucs code is MIT but its weights are probably non-commercial; the BS-RoFormer file declares no licence at all and is a mirror copy
# (its author's Hugging Face page was deleted). Fine for use on your own computer; check before you publish or sell anything built on them.
# Run:  powershell -ExecutionPolicy Bypass -File falling-note-proto\setup_split.ps1 [-Best]
param([switch]$Best)
$ErrorActionPreference = "Stop"
$root = Join-Path $env:USERPROFILE ".waterfall-notes"
$venv = Join-Path $root "split-venv"
$py = Join-Path $venv "Scripts\python.exe"
$gpu = $false
try { nvidia-smi *> $null; $gpu = ($LASTEXITCODE -eq 0) } catch {}

if (-not (Test-Path $py)) {
  Write-Host "Creating the Python environment..."
  New-Item -ItemType Directory -Force $root | Out-Null
  python -m venv $venv
}
& $py -m pip install --upgrade pip
# PyTorch first and on its own: anything that asks for "torch" later would otherwise pull the processor-only build from PyPI over it.
if ($gpu) { & $py -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu126 }
else      { & $py -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu }
& $py -m pip install numpy scipy soundfile librosa einops julius omegaconf dora-search openunmix lameenc pyyaml tqdm rotary-embedding-torch beartype
& $py -m pip install --no-deps demucs

if ($Best) {
  $mdir = Join-Path $root "models\bs-roformer-sw"
  New-Item -ItemType Directory -Force $mdir | Out-Null
  $base = "https://huggingface.co/FractalSurfer/BS-RoFormer-SW-6stem/resolve/main"
  $want = "24e7d35ee9c64415673d3fd33e06a67cac2c103c5df6267ba1576459c775916e"      # the model page lists only the start (24e7d35e) and end (775916e); this is the full value of the file that was downloaded and checked against those
  Write-Host "Downloading the BS-RoFormer files (about 700 MB)..."
  curl.exe -L --fail -o (Join-Path $mdir "BS-Rofo-SW-Fixed.yaml") "$base/BS-Rofo-SW-Fixed.yaml"
  curl.exe -L --fail -o (Join-Path $mdir "BS-Rofo-SW-Fixed.ckpt.part") "$base/BS-Rofo-SW-Fixed.ckpt"
  $got = (Get-FileHash (Join-Path $mdir "BS-Rofo-SW-Fixed.ckpt.part") -Algorithm SHA256).Hash.ToLower()
  if ($got -eq $want) { Move-Item -Force (Join-Path $mdir "BS-Rofo-SW-Fixed.ckpt.part") (Join-Path $mdir "BS-Rofo-SW-Fixed.ckpt") }
  else { throw "The downloaded file's checksum ($got) is not the expected one, so the file was not kept." }
  if (-not (Test-Path (Join-Path $root "msst"))) { git clone --depth 1 https://github.com/ZFTurbo/Music-Source-Separation-Training (Join-Path $root "msst") }
}
Write-Host "Done. Restart the helper (python falling-note-proto\scan_server.py); open 'Split instruments' in the app."
