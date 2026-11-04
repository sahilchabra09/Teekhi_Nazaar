import {expect,test} from "bun:test";
import {hasAudiblePcmWav} from "../src/talk/audio-quality";
function wav(amplitude:number) {
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer);
  const text = (offset:number,value:string) => [...value].forEach((v,i) => bytes[offset+i]=v.charCodeAt(0));
  text(0,"RIFF"); view.setUint32(4,32036,true); text(8,"WAVE"); text(12,"fmt "); view.setUint32(16,16,true);
  view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,16000,true); view.setUint16(34,16,true);
  text(36,"data"); view.setUint32(40,32000,true);
  for(let i=0;i<16000;i++) view.setInt16(44+i*2,Math.sin(2*Math.PI*250*i/16000)*amplitude*32767,true);
  return bytes;
}
test("silence and near-silence never reach speech recognition", () => {
  expect(hasAudiblePcmWav(wav(0))).toBe(false); expect(hasAudiblePcmWav(wav(.0001))).toBe(false);
});
test("quiet audible audio is preserved along with normal-volume audio", () => {
  expect(hasAudiblePcmWav(wav(.01))).toBe(true); expect(hasAudiblePcmWav(wav(.1))).toBe(true);
});
test("unknown codecs and malformed WAVs are delegated rather than misread as PCM", () => {
  expect(hasAudiblePcmWav(new Uint8Array(100))).toBe(null);
  expect(hasAudiblePcmWav(wav(.1).slice(0,100))).toBe(null);
});
