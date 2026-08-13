import { toTokens } from '../extension/src/lib/ruby.js';

const CUES = [
  { zh: '我去银行取钱，然后回家。', en: 'I am going to the bank to withdraw money, then heading home.' },
  { zh: '这个视频没有字幕轨道，所以我们用本地的语音识别。', en: 'This video has no caption track, so we use local speech recognition.' },
  { zh: '长城很长，他长大以后想去看看。', en: 'The Great Wall is long; he wants to visit when he grows up.' },
  { zh: '2024年我看了3部电影，都很好看 OK', en: 'In 2024 I watched 3 movies, all of them good.' },
];

const overlay = document.querySelector('.zhsub-overlay');
const state = { showPinyin: true, showHanzi: true, showEnglish: true };
let i = 0;

function render() {
  const cue = CUES[i];
  overlay.textContent = '';
  const box = document.createElement('div');
  box.className = 'zhsub-cue';

  const line = document.createElement('div');
  line.className = 'zhsub-zh';
  for (const tok of toTokens(cue.zh)) {
    const w = document.createElement('span');
    w.className = tok.han ? 'zhsub-word' : 'zhsub-word zhsub-plain';
    if (tok.punct) w.classList.add(`zhsub-punct-${tok.punct}`);
    if (state.showPinyin && tok.pinyin) {
      const p = document.createElement('span');
      p.className = 'zhsub-py';
      p.textContent = tok.pinyin;
      w.appendChild(p);
    }
    if (state.showHanzi) {
      const h = document.createElement('span');
      h.className = 'zhsub-hz';
      h.textContent = tok.text;
      w.appendChild(h);
    }
    line.appendChild(w);
  }
  box.appendChild(line);

  if (state.showEnglish && cue.en) {
    const en = document.createElement('div');
    en.className = 'zhsub-en';
    en.textContent = cue.en;
    box.appendChild(en);
  }
  overlay.appendChild(box);
}

document.querySelectorAll('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.toggle;
    state[k] = !state[k];
    btn.classList.toggle('off', !state[k]);
    render();
  });
});
document.getElementById('next').addEventListener('click', () => {
  i = (i + 1) % CUES.length;
  render();
});
document.getElementById('size').addEventListener('input', (e) => {
  document.querySelector('.zhsub-host').style.setProperty('--zhsub-size', `${e.target.value}px`);
});

render();
