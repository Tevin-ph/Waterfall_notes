# One-time setup for the piano-only note model (about 1-2 GB: PyTorch + a 165 MB model file).
# Everything goes under your user folder, outside OneDrive/AppData. Run:  powershell -ExecutionPolicy Bypass -File falling-note-proto\setup_piano.ps1
$ErrorActionPreference = "Stop"
$venv = Join-Path $env:USERPROFILE ".waterfall-notes\piano-venv"
$py = Join-Path $venv "Scripts\python.exe"
$modelDir = Join-Path $env:USERPROFILE "piano_transcription_inference_data"
$model = Join-Path $modelDir "note_F1=0.9677_pedal_F1=0.9186.pth"

if (-not (Test-Path $py)) {
  Write-Host "Creating the Python environment..."
  New-Item -ItemType Directory -Force (Split-Path $venv) | Out-Null
  python -m venv $venv
}
Write-Host "Installing PyTorch (CPU) and the piano transcription library..."
& $py -m pip install --upgrade pip
& $py -m pip install torch --index-url https://download.pytorch.org/whl/cpu
& $py -m pip install piano_transcription_inference

if (-not (Test-Path $model) -or (Get-Item $model).Length -lt 160MB) {
  Write-Host "Downloading the model file (about 165 MB) from the author's Zenodo page..."
  New-Item -ItemType Directory -Force $modelDir | Out-Null
  curl.exe -L --fail -o "$model.part" "https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
  Move-Item -Force "$model.part" $model
}
Write-Host "Done. Start the app with: python falling-note-proto\scan_server.py"
