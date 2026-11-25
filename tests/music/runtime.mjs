import assert from 'node:assert/strict';
import { Packet, engineModule, id } from '../swamp-caves/runtime.mjs';
export * from '../swamp-caves/runtime.mjs';

const MidiSong = (await engineModule('network/game/server/model/MidiSong.ts')).default;
const MidiSongEncoder = (await engineModule('network/game/server/codec/MidiSongEncoder.ts')).default;
const encoder = new MidiSongEncoder();

// Observe transport writes only. Selection and unlocks remain compiled product code.
export const musicMark = p => p.packets.length;
export const musicPackets = (p, mark = 0) => p.packets.slice(mark).filter(packet => packet instanceof MidiSong).map(packet => {
  const encoded = new Packet(new Uint8Array(2));
  encoder.encode(encoded, packet);
  return { opcode: encoder.prot.id, id: packet.id, payload: [...encoded.data.subarray(0, encoded.pos)] };
});
export function expectMusic(p, mark, midi, payload) {
  assert.deepEqual(musicPackets(p, mark), [{ opcode: 220, id: midi, payload }], 'exactly one fresh opcode-220 identity/payload');
  assert.equal(p.vars[id('VarPlayerType', 'currentsong')], midi, 'server current song');
}
export const musicBits = p => Array.from({ length: 14 }, (_, i) => p.vars[id('VarPlayerType', `musicmulti_${i + 1}`)]);
export const musicText = (p, mark = 0) => p.packets.slice(mark).filter(packet => packet.constructor.name === 'IfSetText' && packet.component === id('Component', 'music:com_177')).map(packet => packet.text);
