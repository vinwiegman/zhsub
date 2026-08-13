import { toTokens } from './extension/src/lib/ruby.js';

// Polyphones are the whole game: a per-character dictionary lookup gets these
// wrong, which is why most extensions' pinyin is subtly useless.
const cases = [
  ['我去银行取钱', 'yín háng, not yín xíng'],
  ['长城很长', 'cháng chéng + cháng'],
  ['他长大了', 'zhǎng dà, not cháng'],
  ['这很重要，不要重复', 'zhòng yào + chóng fù'],
  ['我还没还钱', 'hái + huán'],
  ['音乐很快乐', 'yīn yuè + kuài lè'],
  ['他的头发发白了', 'tóu fa + fā bái'],
  ['2024年我看了3部电影 OK', 'mixed digits + latin'],
  ['你好，世界！', 'punctuation'],
];

let width = 0;
const rows = cases.map(([text, note]) => {
  const toks = toTokens(text);
  const py = toks.map((t) => (t.pinyin ? t.pinyin : t.text)).join(' | ');
  const words = toks.map((t) => t.text).join(' / ');
  width = Math.max(width, words.length);
  return { text, note, py, words };
});

for (const r of rows) {
  console.log(`${r.words.padEnd(width)}   ${r.py}`);
  console.log(`${' '.repeat(width)}   ↑ expect: ${r.note}\n`);
}
