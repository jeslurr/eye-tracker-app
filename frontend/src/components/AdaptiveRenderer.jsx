import { useEffect, useState } from 'react';

const AUDIO_BANK = {};

function speak(text) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.85;
  u.pitch = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export default function AdaptiveRenderer({ target, action }) {
  const [highlighted, setHighlighted] = useState(false);
  const [split, setSplit] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!action) return;
    const at = action.t;
    switch (action.action) {
      case 'HIGHLIGHT_LETTERS':
        setHighlighted(true);
        setTimeout(() => setHighlighted(false), 2400);
        break;
      case 'SPLIT_WORD':
        setSplit(true);
        setTimeout(() => setSplit(false), 4000);
        break;
      case 'PLAY_AUDIO':
        speak(target);
        break;
      case 'SIMPLIFY_UI':
        setSimplified(true);
        setTimeout(() => setSimplified(false), 5000);
        break;
      case 'ATTENTION_PROMPT':
        setPulse(true);
        setTimeout(() => setPulse(false), 1600);
        break;
      default:
        break;
    }
    void AUDIO_BANK; void at;
  }, [action, target]);

  const text = target ?? '';
  const cls = [
    'target-card',
    simplified ? 'simplified' : '',
    pulse ? 'attention-pulse' : '',
  ].filter(Boolean).join(' ');

  const isWord = text.length > 1 && /^[A-Za-z]+$/.test(text);
  const isSentence = /\s/.test(text);

  return (
    <div data-target={text} className={cls}>
      {isSentence ? (
        <SentenceRenderer text={text} highlighted={highlighted} />
      ) : isWord ? (
        <WordRenderer word={text} highlighted={highlighted} split={split} />
      ) : (
        <span className={highlighted ? 'letter highlighted' : 'letter'}>{text}</span>
      )}
    </div>
  );
}

function WordRenderer({ word, highlighted, split }) {
  return (
    <span>
      {word.split('').map((ch, i) => (
        <span
          key={i}
          className={['letter', highlighted ? 'highlighted' : '', split ? 'split' : ''].filter(Boolean).join(' ')}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function SentenceRenderer({ text, highlighted }) {
  return (
    <span style={{ fontSize: '0.45em', lineHeight: 1.5, textAlign: 'center', padding: '0 0.5em' }}>
      {text.split(/(\s+)/).map((token, i) =>
        token.trim() ? (
          <span key={i} className={highlighted ? 'letter highlighted' : 'letter'}>{token}</span>
        ) : (
          <span key={i}>{token}</span>
        )
      )}
    </span>
  );
}
