Set-Location $PSScriptRoot
uv run python -m uvicorn backend.main:app --reload --port 8000
