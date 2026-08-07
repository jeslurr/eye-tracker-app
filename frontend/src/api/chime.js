/**
 * A soft two-note chime for the "I can't see your eyes" alert.
 *
 * Synthesised rather than shipped as an audio file so there is no asset to load
 * and no delay on the first play. Sine waves with a gentle attack and long decay
 * deliberately: the listener is a child who may already find reading stressful,
 * and a harsh buzzer every ten seconds would punish them for looking away.
 */

let ctx = null;

function context() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  // Browsers suspend audio contexts created before a user gesture.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Play a descending two-note chime. Safe to call when audio is unavailable. */
export function playAttentionChime(volume = 0.12) {
  const audio = context();
  if (!audio) return;
  const start = audio.currentTime;

  for (const [freq, offset] of [[784, 0], [587.33, 0.16]]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }
}

/**
 * Speak a short prompt, but only when nothing else is talking.
 *
 * The game speaks the target word each round and `speak()` in GameScreen calls
 * speechSynthesis.cancel() first. An alert that ignored that would cut off the
 * instruction the child is waiting for, making the game unplayable exactly when
 * they are already struggling.
 */
export function speakIfQuiet(text) {
  const synth = window.speechSynthesis;
  if (!synth || synth.speaking || synth.pending) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.1;
  synth.speak(utterance);
  return true;
}
