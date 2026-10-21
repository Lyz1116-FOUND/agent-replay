# Launch media checks

Checks performed for the final 2026-10-21 media publication:

| Surface | Check |
| --- | --- |
| Master video | 1920×1080, 30fps, 900 frames, 30.000s; H.264/yuv420p, stereo AAC 48kHz; complete FFmpeg decode exits successfully |
| Other exports | 720p and video-only versions retain 900 frames / 30s; video-only has no audio stream |
| Sound | Encoded master measured −17.04 LUFS, −1.23 dBTP, 7.30 LU LRA; original procedural score/effects with no outside music |
| Source rendering | 900 rendered frames; no browser page errors |
| Public copy | The watch page’s MP4 is byte-identical to the exported master |
| Player | Native playback advances, seek succeeds, 30s/1080p metadata loads, autoplay is disabled, nine optional sound-description cues load |
| Mobile page | 390px viewport / 390px document width; one page header, one main region, no media element error |
| Navigation | Watch page → Live Demo opens the actual replay app |
| README | Both languages’ relative file links exist; GitHub Markdown rendering retains the linked animation and watch/download links |
| Product regression checks | Local typecheck + demo build, lint, 25 test files / 210 tests passed |
| Fonts | Bundled bytes match installed Fontsource Latin variable fonts; SIL OFL texts included |

Browser media requests cancelled during seeking or leaving the page were recorded separately from actual failures. Playback, seeking and the media error state were checked; expected `ERR_ABORTED` cancellations are not counted as broken downloads.

The original v6 footage, earlier previews and release assets remain available. The film is not a new live agent recording; the LRU and OpenCode segments are explicitly separate. Read the source boundaries in [README](README.md).

These checks establish technical delivery and some layout/navigation behavior. They do not establish audience response, subjective listening quality, or Safari compatibility. The GitHub Actions results for the publication commit are linked from the repository’s CI badge.
