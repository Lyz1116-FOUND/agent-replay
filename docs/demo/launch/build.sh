#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
project_root="$(cd ../../.. && pwd)"
launch_output="${LAUNCH_OUTPUT:-${project_root}/demo-output/agent-replay-launch-final}"
mkdir -p "$launch_output"
export LAUNCH_OUTPUT="$launch_output"
if [[ "${1:-}" != "--encode-only" ]]; then
  node render.mjs
fi
python3 audio.py
ffmpeg -hide_banner -i "$launch_output/soundtrack.wav" \
  -af 'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json' -f null - \
  2> "$launch_output/normalization-measurement.txt"
launch_filter="$(python3 - <<'PY'
import json,os,re
from pathlib import Path
s=(Path(os.environ['LAUNCH_OUTPUT'])/'normalization-measurement.txt').read_text()
m=json.loads(re.findall(r'\{[^{}]+\}',s)[-1])
for k in ('input_i','input_tp','input_lra','input_thresh','target_offset'):float(m[k])
print('loudnorm=I=-16:TP=-1.5:LRA=9:measured_I='+m['input_i']+':measured_TP='+m['input_tp']+':measured_LRA='+m['input_lra']+':measured_thresh='+m['input_thresh']+':offset='+m['target_offset']+':linear=true')
PY
)"
ffmpeg -v error -y -framerate 30 -i "$launch_output/frames/%04d.png" -i "$launch_output/soundtrack.wav" \
  -c:v libx264 -crf 17 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 \
  -af "$launch_filter" -movflags +faststart -t 30 "$launch_output/agent-replay-launch-1080p.mp4"
ffmpeg -v error -y -i "$launch_output/agent-replay-launch-1080p.mp4" -vf scale=1280:720 \
  -c:v libx264 -crf 20 -preset medium -c:a copy -movflags +faststart "$launch_output/agent-replay-launch-720p.mp4"
ffmpeg -v error -y -i "$launch_output/agent-replay-launch-1080p.mp4" -c:v copy -an "$launch_output/agent-replay-launch-video-only.mp4"
ffmpeg -v error -y -ss 28.5 -i "$launch_output/agent-replay-launch-1080p.mp4" -frames:v 1 "$launch_output/poster.jpg"
ffmpeg -v error -y -i "$launch_output/agent-replay-launch-720p.mp4" \
  -vf 'fps=1,scale=480:270,tile=5x6' -frames:v 1 "$launch_output/storyboard.jpg"
