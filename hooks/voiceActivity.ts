// Reports the mic's loudness (RMS, roughly 0..1) every `intervalMs`. Used for
// barge-in: the stream should have echo cancellation on, so the interviewer's
// own voice coming out of the speakers is mostly removed. Returns a stop function.
export function watchVoice(stream: MediaStream, onLevel: (rms: number) => void, intervalMs = 50) {
  const ctx = new AudioContext();
  ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    onLevel(Math.sqrt(sum / buf.length));
  }, intervalMs);
  return () => {
    clearInterval(id);
    ctx.close().catch(() => {});
  };
}
