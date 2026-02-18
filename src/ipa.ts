export interface PhonemeInfo {
  symbol: string;
  example: string;
  exampleWord: string;
}

const PHONEME_MAP: Record<string, { example: string; word: string }> = {
  // Consonants
  'p': { example: '/p/', word: 'pen' },
  'b': { example: '/b/', word: 'boy' },
  't': { example: '/t/', word: 'ten' },
  'd': { example: '/d/', word: 'day' },
  'k': { example: '/k/', word: 'cat' },
  'ɡ': { example: '/ɡ/', word: 'go' },
  'g': { example: '/g/', word: 'go' },
  'f': { example: '/f/', word: 'five' },
  'v': { example: '/v/', word: 'very' },
  'θ': { example: '/θ/', word: 'think' },
  'ð': { example: '/ð/', word: 'this' },
  's': { example: '/s/', word: 'see' },
  'z': { example: '/z/', word: 'zoo' },
  'ʃ': { example: '/ʃ/', word: 'she' },
  'ʒ': { example: '/ʒ/', word: 'vision' },
  'h': { example: '/h/', word: 'he' },
  'tʃ': { example: '/tʃ/', word: 'cheese' },
  'dʒ': { example: '/dʒ/', word: 'just' },
  'm': { example: '/m/', word: 'moon' },
  'n': { example: '/n/', word: 'no' },
  'ŋ': { example: '/ŋ/', word: 'sing' },
  'l': { example: '/l/', word: 'look' },
  'ɹ': { example: '/ɹ/', word: 'red' },
  'r': { example: '/r/', word: 'red' },
  'j': { example: '/j/', word: 'yes' },
  'w': { example: '/w/', word: 'we' },
  'ɾ': { example: '/ɾ/', word: 'butter' },

  // Short vowels
  'ɪ': { example: '/ɪ/', word: 'sit' },
  'e': { example: '/e/', word: 'bed' },
  'ɛ': { example: '/ɛ/', word: 'bed' },
  'æ': { example: '/æ/', word: 'cat' },
  'ʌ': { example: '/ʌ/', word: 'cup' },
  'ʊ': { example: '/ʊ/', word: 'put' },
  'ə': { example: '/ə/', word: 'above' },
  'ɐ': { example: '/ɐ/', word: 'cup' },
  'ɒ': { example: '/ɒ/', word: 'hot' },

  // Long vowels
  'iː': { example: '/iː/', word: 'see' },
  'i': { example: '/i/', word: 'happy' },
  'ɑː': { example: '/ɑː/', word: 'father' },
  'ɑ': { example: '/ɑ/', word: 'father' },
  'ɔː': { example: '/ɔː/', word: 'law' },
  'ɔ': { example: '/ɔ/', word: 'law' },
  'uː': { example: '/uː/', word: 'blue' },
  'u': { example: '/u/', word: 'blue' },
  'ɜː': { example: '/ɜː/', word: 'bird' },
  'ɜ': { example: '/ɜ/', word: 'bird' },
  'ɝ': { example: '/ɝ/', word: 'bird' },
  'ɚ': { example: '/ɚ/', word: 'letter' },

  // Diphthongs
  'eɪ': { example: '/eɪ/', word: 'say' },
  'aɪ': { example: '/aɪ/', word: 'my' },
  'ɔɪ': { example: '/ɔɪ/', word: 'boy' },
  'aʊ': { example: '/aʊ/', word: 'now' },
  'oʊ': { example: '/oʊ/', word: 'go' },
  'ɪə': { example: '/ɪə/', word: 'ear' },
  'ɪɹ': { example: '/ɪɹ/', word: 'ear' },
  'eə': { example: '/eə/', word: 'air' },
  'eɹ': { example: '/eɹ/', word: 'air' },
  'ʊə': { example: '/ʊə/', word: 'tour' },
  'ʊɹ': { example: '/ʊɹ/', word: 'tour' },
  'ɑɹ': { example: '/ɑɹ/', word: 'car' },
  'ɔɹ': { example: '/ɔɹ/', word: 'more' },
};

// Multi-char tokens sorted longest-first for greedy matching
const MULTI_TOKENS = Object.keys(PHONEME_MAP)
  .filter((k) => k.length > 1)
  .sort((a, b) => b.length - a.length);

const SKIP_CHARS = new Set(['ˈ', 'ˌ', '.', '/', ' ', ',', '(', ')']);

export function parseIPA(ipa: string): PhonemeInfo[] {
  const clean = ipa.replace(/^\/|\/$/g, '').trim();
  const result: PhonemeInfo[] = [];
  let i = 0;

  while (i < clean.length) {
    if (SKIP_CHARS.has(clean[i])) {
      i++;
      continue;
    }

    let matched = false;

    for (const token of MULTI_TOKENS) {
      if (clean.startsWith(token, i)) {
        const info = PHONEME_MAP[token];
        result.push({
          symbol: info.example,
          example: 'as in',
          exampleWord: info.word,
        });
        i += token.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const ch = clean[i];
      // Handle vowel + ː (length mark) that isn't in the map as a multi-token
      if (i + 1 < clean.length && clean[i + 1] === 'ː') {
        const longVowel = ch + 'ː';
        const info = PHONEME_MAP[longVowel] || PHONEME_MAP[ch];
        if (info) {
          result.push({
            symbol: info.example,
            example: 'as in',
            exampleWord: info.word,
          });
        }
        i += 2;
      } else {
        const info = PHONEME_MAP[ch];
        if (info) {
          result.push({
            symbol: info.example,
            example: 'as in',
            exampleWord: info.word,
          });
        }
        i++;
      }
    }
  }

  return result;
}
