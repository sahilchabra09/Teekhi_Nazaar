/** Reject near-silent PCM WAVs before asking STT to guess words. Other codecs are left to the provider. */
export function hasAudiblePcmWav(bytes: Uint8Array): boolean | null {
  if (bytes.length < 44) return null;
  const text = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0, channels = 0, pcm16 = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) return null;
    if (text(offset, 4) === "fmt " && size >= 16) {
      pcm16 = view.getUint16(start, true) === 1 && view.getUint16(start + 14, true) === 16;
      channels = view.getUint16(start + 2, true); rate = view.getUint32(start + 4, true);
    }
    if (text(offset, 4) === "data") {
      if (!pcm16 || rate <= 0 || channels <= 0 || size % 2 !== 0) return null;
      const frameSamples = Math.max(1, Math.round(rate * channels * .02));
      let energy = 0, count = 0, audibleFrames = 0;
      for (let p = start; p + 1 < start + size; p += 2) {
        const sample = view.getInt16(p, true) / 32768;
        energy += sample * sample; count++;
        if (count === frameSamples) {
          if (Math.sqrt(energy / count) >= .002) audibleFrames++;
          energy = 0; count = 0;
        }
      }
      return audibleFrames >= 5; // At least 100 ms above near-silence; not a speech classifier.
    }
    offset = start + size + size % 2;
  }
  return null;
}
