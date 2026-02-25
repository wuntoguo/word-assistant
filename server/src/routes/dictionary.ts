import { Router, Request, Response } from 'express';

export const dictionaryRouter = Router();

const cache = new Map<string, { data: MWResult; fetchedAt: number }>();
const learnerCache = new Map<string, { data: MWResult; fetchedAt: number }>();
const intermediateCache = new Map<string, { data: MWResult; fetchedAt: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

interface MWResult {
  phonetic: string;
  audioUrl: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
}

function getMWAudioUrl(audio: string): string {
  let subdir: string;
  if (audio.startsWith('bix')) subdir = 'bix';
  else if (audio.startsWith('gg')) subdir = 'gg';
  else if (/^[^a-zA-Z]/.test(audio)) subdir = 'number';
  else subdir = audio[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
}

function cleanMWMarkup(text: string): string {
  return text
    .replace(/\{bc\}/g, '')
    .replace(/\{it\}(.*?)\{\/it\}/g, '$1')
    .replace(/\{ldquo\}/g, '\u201C')
    .replace(/\{rdquo\}/g, '\u201D')
    .replace(/\{a_link\|([^}]+)\}/g, '$1')
    .replace(/\{d_link\|([^|]+)\|[^}]*\}/g, '$1')
    .replace(/\{sx\|([^|]+)\|[^}]*\}/g, '$1')
    .replace(/\{wi\}(.*?)\{\/wi\}/g, '$1')
    .replace(/\{phrase\}(.*?)\{\/phrase\}/g, '$1')
    .replace(/\{[^}]+\}/g, '')
    .trim();
}

function parseMWResponse(entries: unknown[]): MWResult | null {
  // MW returns strings (suggestions) when word is not found
  if (!entries.length || typeof entries[0] === 'string') return null;

  const entry = entries[0] as Record<string, unknown>;
  const hwi = entry.hwi as Record<string, unknown> | undefined;
  if (!hwi) return null;

  // Phonetic & audio
  let phonetic = '';
  let audioUrl = '';
  const prs = hwi.prs as Array<Record<string, unknown>> | undefined;
  if (prs && prs.length > 0) {
    const pr = prs[0];
    // Prefer IPA if available, otherwise use MW notation
    if (pr.ipa) {
      phonetic = `/${pr.ipa as string}/`;
    } else if (pr.mw) {
      phonetic = `/${pr.mw as string}/`;
    }
    const sound = pr.sound as Record<string, string> | undefined;
    if (sound?.audio) {
      audioUrl = getMWAudioUrl(sound.audio);
    }
  }

  // Part of speech
  const partOfSpeech = (entry.fl as string) || '';

  // Definitions from shortdef (clean, simple)
  const shortdef = (entry.shortdef as string[]) || [];
  const definitions = shortdef.slice(0, 3).map((d) => d.charAt(0).toUpperCase() + d.slice(1));

  // Examples from full def tree
  const examples: string[] = [];
  try {
    const def = entry.def as Array<Record<string, unknown>> | undefined;
    if (def) {
      for (const defBlock of def) {
        const sseq = defBlock.sseq as unknown[][][] | undefined;
        if (!sseq) continue;
        for (const senseGroup of sseq) {
          for (const senseItem of senseGroup) {
            if (!Array.isArray(senseItem) || senseItem[0] !== 'sense') continue;
            const senseData = senseItem[1] as Record<string, unknown>;
            const dt = senseData.dt as unknown[][] | undefined;
            if (!dt) continue;
            for (const dtItem of dt) {
              if (dtItem[0] === 'vis') {
                const visList = dtItem[1] as Array<Record<string, string>>;
                for (const vis of visList) {
                  if (vis.t && examples.length < 4) {
                    examples.push(cleanMWMarkup(vis.t));
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Complex nested parsing — ignore errors
  }

  // Also check additional entries for more examples
  for (let i = 1; i < Math.min(entries.length, 3) && examples.length < 4; i++) {
    const extra = entries[i] as Record<string, unknown>;
    if (typeof extra === 'string') break;
    try {
      const def = extra.def as Array<Record<string, unknown>> | undefined;
      if (!def) continue;
      for (const defBlock of def) {
        const sseq = defBlock.sseq as unknown[][][] | undefined;
        if (!sseq) continue;
        for (const senseGroup of sseq) {
          for (const senseItem of senseGroup) {
            if (!Array.isArray(senseItem) || senseItem[0] !== 'sense') continue;
            const senseData = senseItem[1] as Record<string, unknown>;
            const dt = senseData.dt as unknown[][] | undefined;
            if (!dt) continue;
            for (const dtItem of dt) {
              if (dtItem[0] === 'vis') {
                const visList = dtItem[1] as Array<Record<string, string>>;
                for (const vis of visList) {
                  if (vis.t && examples.length < 4 && !examples.includes(cleanMWMarkup(vis.t))) {
                    examples.push(cleanMWMarkup(vis.t));
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { phonetic, audioUrl, partOfSpeech, definitions, examples };
}

dictionaryRouter.get('/:word', async (req: Request, res: Response) => {
  const word = (req.params.word as string)?.trim().toLowerCase();
  if (!word) {
    res.status(400).json({ error: 'Word is required' });
    return;
  }

  const apiKey = process.env.MW_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Merriam-Webster API key not configured' });
    return;
  }

  const cached = cache.get(word);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${apiKey}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      res.status(resp.status).json({ error: 'MW API request failed' });
      return;
    }

    const data = await resp.json() as unknown[];
    const result = parseMWResponse(data);

    if (!result) {
      res.status(404).json({ error: 'Word not found in Merriam-Webster' });
      return;
    }

    cache.set(word, { data: result, fetchedAt: Date.now() });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch from Merriam-Webster' });
  }
});

// MW Learner's Dictionary — simple definitions for ESL learners
export const learnerRouter = Router();

learnerRouter.get('/:word', async (req: Request, res: Response) => {
  const word = (req.params.word as string)?.trim().toLowerCase();
  if (!word) {
    res.status(400).json({ error: 'Word is required' });
    return;
  }

  const apiKey = process.env.MW_LEARNER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Merriam-Webster Learner API key not configured' });
    return;
  }

  const cached = learnerCache.get(word);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const url = `https://www.dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${apiKey}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      res.status(resp.status).json({ error: 'MW Learner API request failed' });
      return;
    }

    const data = await resp.json() as unknown[];
    const result = parseMWResponse(data);

    if (!result) {
      res.status(404).json({ error: 'Word not found in Learner\'s Dictionary' });
      return;
    }

    learnerCache.set(word, { data: result, fetchedAt: Date.now() });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch from Learner\'s Dictionary' });
  }
});

// MW Intermediate Dictionary (Grades 6–8) — simpler definitions, uses same structure
export const intermediateRouter = Router();

intermediateRouter.get('/:word', async (req: Request, res: Response) => {
  const word = (req.params.word as string)?.trim().toLowerCase();
  if (!word) {
    res.status(400).json({ error: 'Word is required' });
    return;
  }

  const apiKey = process.env.MW_INTERMEDIATE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Merriam-Webster Intermediate API key not configured' });
    return;
  }

  const cached = intermediateCache.get(word);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const url = `https://www.dictionaryapi.com/api/v3/references/sd3/json/${encodeURIComponent(word)}?key=${apiKey}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      res.status(resp.status).json({ error: 'MW Intermediate API request failed' });
      return;
    }

    const data = await resp.json() as unknown[];
    const result = parseMWResponse(data);

    if (!result) {
      res.status(404).json({ error: 'Word not found in Intermediate Dictionary' });
      return;
    }

    intermediateCache.set(word, { data: result, fetchedAt: Date.now() });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch from Intermediate Dictionary' });
  }
});
