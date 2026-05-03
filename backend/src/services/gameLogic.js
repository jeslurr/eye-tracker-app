const PROGRESSION = ['shapes', 'letters', 'words', 'sentences'];

const CONTENT = {
  shapes: [
    ['circle', 'square', 'triangle'],
    ['circle', 'square', 'triangle', 'star', 'heart'],
  ],
  letters: [
    ['A', 'B', 'C', 'D', 'E'],
    ['F', 'G', 'H', 'I', 'J', 'K'],
    ['L', 'M', 'N', 'O', 'P', 'Q'],
  ],
  words: [
    ['cat', 'dog', 'sun', 'bat', 'pig'],
    ['fish', 'bird', 'tree', 'ball', 'rain'],
  ],
  sentences: [
    ['The cat sat on the mat.', 'A dog can run fast.', 'I see a red ball.'],
    ['The sun is hot today.', 'My pet bird can sing.'],
  ],
};

export function nextLevelFor(currentLevel, promoted) {
  const idx = PROGRESSION.indexOf(currentLevel);
  if (!promoted) return currentLevel;
  return PROGRESSION[Math.min(idx + 1, PROGRESSION.length - 1)];
}

export function getTargets(level, difficulty = 1) {
  const bank = CONTENT[level] || [];
  return bank[Math.min(difficulty - 1, bank.length - 1)] || bank[0] || [];
}

export function shouldPromote(result) {
  const acc = result.total ? result.correct / result.total : 0;
  const struggleEvents =
    (result.eventCounts?.CONFUSION || 0) +
    (result.eventCounts?.DECODING_ISSUE || 0) +
    (result.eventCounts?.SKIP || 0);
  return acc >= 0.8 && struggleEvents <= result.total;
}

export { PROGRESSION };
