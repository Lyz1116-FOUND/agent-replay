#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
pointer_output="${POINTER_OUTPUT:-demo-output/agent-replay-pointer-release}"
export POINTER_OUTPUT="$pointer_output"
python3 - <<'PY'
import json,os
from pathlib import Path
root=Path(os.environ['POINTER_OUTPUT'])
frames=list((root/'frames').glob('*.png'))
assert len(frames)==1440, f'Expected 1440 frames, got {len(frames)}'
report=json.loads((root/'render-0-1440.json').read_text())
assert report['deterministic'] and not report['framingFailures'] and not report['errors'], report
(root/'render-report.json').write_text(json.dumps(report,indent=2))
PY
ffmpeg -v error -y -framerate 60 -i "$pointer_output/frames/%04d.png" -i "$pointer_output/soundtrack.wav" \
 -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p -c:a aac -b:a 256k -ar 48000 -af 'loudnorm=I=-18:TP=-4:LRA=7' \
 -movflags +faststart -t 24 "$pointer_output/agent-replay-pointer-final-1080p60.mp4"
ffmpeg -v error -y -ss 22 -i "$pointer_output/agent-replay-pointer-final-1080p60.mp4" -frames:v 1 "$pointer_output/poster.jpg"
ffmpeg -v error -y -i "$pointer_output/agent-replay-pointer-final-1080p60.mp4" -vf 'fps=1,scale=480:270,tile=6x4' -frames:v 1 "$pointer_output/storyboard.jpg"
cp "$pointer_output/render-report.json" "$pointer_output/agent-replay-pointer-final-1080p60.render.json"
