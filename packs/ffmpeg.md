Audio and video with `ffmpeg` and `ffprobe`. **The original is never overwritten:** always a new output file, and `-n` so an existing one is never replaced.

**Look first:** `ffprobe -v error -show_format -show_streams -of json in.mp4` (codecs, duration, sizes, sample rate).

**Common work:**

- convert: `ffmpeg -n -i in.mov -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 160k out.mp4`,
- cut without re-encoding: `ffmpeg -n -ss 00:01:00 -to 00:02:00 -i in.mp4 -c copy part.mp4` (cuts land on keyframes; re-encode for an exact cut),
- audio only: `ffmpeg -n -i in.mp4 -vn -c:a libmp3lame -q:a 2 out.mp3`,
- loudness: `ffmpeg -i in.wav -af ebur128=peak=true -f null -` (integrated LUFS and true peak at the end),
- a spectrum picture: `ffmpeg -n -i in.wav -lavfi showspectrumpic=s=1024x512 spectrum.png`.

**Before calling it done:** `ffprobe` the output (duration, streams), and for a cut or a mix listen or look at the part that changed; say what was measured.
