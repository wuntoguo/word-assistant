/**
 * Common English words and confusables for multiple-choice distractors.
 * Used when user's vocabulary doesn't provide enough options.
 */

// Commonly confused word pairs/groups (similar sound, spelling, or meaning)
export const CONFUSABLES: string[][] = [
  ['affect', 'effect'],
  ['accept', 'except'],
  ['advice', 'advise'],
  ['allude', 'elude'],
  ['assure', 'ensure', 'insure'],
  ['bare', 'bear'],
  ['breach', 'breech'],
  ['capital', 'capitol'],
  ['cite', 'site', 'sight'],
  ['complement', 'compliment'],
  ['council', 'counsel'],
  ['decent', 'descent', 'dissent'],
  ['desert', 'dessert'],
  ['elicit', 'illicit'],
  ['eminent', 'imminent'],
  ['farther', 'further'],
  ['forward', 'foreword'],
  ['hoard', 'horde'],
  ['hole', 'whole'],
  ['its', 'it\'s'],
  ['lay', 'lie'],
  ['led', 'lead'],
  ['lessen', 'lesson'],
  ['loose', 'lose'],
  ['moral', 'morale'],
  ['passed', 'past'],
  ['peace', 'piece'],
  ['principal', 'principle'],
  ['proceed', 'precede'],
  ['quiet', 'quite'],
  ['raise', 'rise'],
  ['respectively', 'respectfully'],
  ['sense', 'since'],
  ['stationary', 'stationery'],
  ['than', 'then'],
  ['their', 'there', 'they\'re'],
  ['to', 'too', 'two'],
  ['weather', 'whether'],
  ['whose', 'who\'s'],
  ['your', 'you\'re'],
  ['adapt', 'adopt', 'adept'],
  ['altar', 'alter'],
  ['adverse', 'averse'],
  ['allusion', 'illusion'],
  ['appraise', 'apprise'],
  ['conscience', 'conscious'],
  ['cereal', 'serial'],
  ['coarse', 'course'],
  ['dual', 'duel'],
  ['pedal', 'peddle'],
  ['perspective', 'prospective'],
  ['predator', 'prey', 'predatory'],
  ['prey', 'pray'],
  ['device', 'devise'],
  ['imply', 'infer'],
  ['tortuous', 'torturous'],
  ['wander', 'wonder'],
];

// General pool of common English words (for random distractors)
export const COMMON_WORDS = [
  'ability', 'absence', 'abstract', 'accept', 'access', 'accident', 'account', 'action', 'active',
  'adapt', 'address', 'advance', 'advantage', 'adventure', 'advice', 'affect', 'agency', 'agent',
  'agreement', 'air', 'alternative', 'amount', 'analysis', 'animal', 'annual', 'answer', 'anxiety',
  'approach', 'area', 'argument', 'aspect', 'attack', 'attempt', 'attention', 'attitude', 'audience',
  'author', 'average', 'awareness', 'balance', 'barrier', 'batch', 'battle', 'beauty', 'behavior',
  'benefit', 'blame', 'border', 'branch', 'budget', 'burden', 'button', 'cable', 'campaign',
  'capacity', 'capture', 'category', 'cause', 'challenge', 'channel', 'character', 'charge', 'choice',
  'circuit', 'climate', 'cluster', 'coach', 'code', 'column', 'combination', 'comfort', 'comment',
  'commission', 'commitment', 'communication', 'community', 'comparison', 'competition', 'complex',
  'component', 'concept', 'concern', 'conclusion', 'condition', 'conflict', 'connection', 'consequence',
  'constant', 'context', 'contract', 'contrast', 'convention', 'conversation', 'core', 'corner',
  'cost', 'county', 'couple', 'course', 'creation', 'credit', 'culture', 'curve', 'cycle',
  'damage', 'danger', 'database', 'debate', 'decade', 'decision', 'definition', 'degree', 'delay',
  'delivery', 'demand', 'design', 'detail', 'device', 'difference', 'difficulty', 'dimension',
  'direction', 'disaster', 'discount', 'discussion', 'dispute', 'distance', 'district', 'divide',
  'doctor', 'document', 'domain', 'doubt', 'draft', 'driver', 'economy', 'edition', 'effort',
  'element', 'emphasis', 'employer', 'energy', 'engine', 'enhancement', 'episode', 'equation',
  'equipment', 'error', 'escape', 'estimate', 'event', 'evidence', 'exception', 'existence',
  'expansion', 'experience', 'expert', 'export', 'extension', 'extent', 'factor', 'failure',
  'feature', 'feedback', 'figure', 'finance', 'finding', 'focus', 'force', 'formal', 'format',
  'forum', 'foundation', 'frame', 'frequency', 'function', 'fund', 'gallery', 'gap', 'gate',
  'generation', 'gift', 'goal', 'grade', 'grant', 'growth', 'guide', 'handle', 'highlight',
  'holder', 'horror', 'host', 'hypothesis', 'identity', 'impact', 'import', 'income', 'increase',
  'indicator', 'individual', 'industry', 'initial', 'instance', 'interest', 'interview', 'introduction',
  'investment', 'item', 'joint', 'journal', 'judgment', 'justice', 'layer', 'league', 'level',
  'library', 'limit', 'link', 'list', 'load', 'location', 'loss', 'machine', 'magazine',
  'maintenance', 'majority', 'manner', 'margin', 'material', 'matrix', 'maximum', 'medium',
  'member', 'memory', 'method', 'middle', 'minimum', 'mission', 'mixture', 'mode', 'model',
  'moment', 'motion', 'motor', 'museum', 'network', 'novel', 'notion', 'number', 'object',
  'obligation', 'occasion', 'option', 'output', 'owner', 'package', 'panel', 'partner', 'path',
  'pattern', 'pause', 'payment', 'performance', 'period', 'phase', 'phenomenon', 'philosophy',
  'phrase', 'platform', 'player', 'potential', 'pressure', 'principle', 'prior', 'priority',
  'process', 'product', 'profile', 'profit', 'program', 'project', 'proof', 'property',
  'proposal', 'protocol', 'purpose', 'quality', 'quantity', 'quote', 'range', 'rate', 'ratio',
  'reality', 'reason', 'recognition', 'record', 'reference', 'reflection', 'region', 'relation',
  'release', 'replace', 'report', 'requirement', 'research', 'resource', 'response', 'rest',
  'result', 'return', 'review', 'revolution', 'reward', 'rise', 'risk', 'role', 'route',
  'routine', 'rule', 'sample', 'scale', 'scene', 'scheme', 'scope', 'section', 'sector',
  'segment', 'series', 'service', 'session', 'setting', 'shift', 'signal', 'significance',
  'similarity', 'site', 'skill', 'solution', 'sort', 'source', 'space', 'species', 'speech',
  'spirit', 'stage', 'standard', 'state', 'status', 'step', 'strategy', 'stream', 'stress',
  'structure', 'study', 'style', 'subject', 'success', 'summary', 'support', 'survey', 'system',
  'target', 'task', 'technique', 'term', 'theme', 'theory', 'thing', 'thought', 'topic',
  'tradition', 'traffic', 'training', 'transfer', 'transition', 'trend', 'trial', 'trigger',
  'trust', 'type', 'unit', 'version', 'video', 'view', 'virus', 'voice', 'volume', 'warning',
  'weight', 'welfare', 'wheel', 'will', 'wing', 'witness', 'worker', 'zone',
];

/** Get distractors for a word: prefer confusables, then similar-length common words */
export function getDistractorWords(targetWord: string, exclude: Set<string>, count: number): string[] {
  const target = targetWord.toLowerCase();
  const len = target.length;
  const result: string[] = [];

  // 1. Try confusables (words in same group as target)
  for (const group of CONFUSABLES) {
    if (group.some((w) => w.toLowerCase() === target)) {
      for (const w of group) {
        const lower = w.toLowerCase();
        if (lower !== target && !exclude.has(lower) && !result.includes(w)) {
          result.push(w);
          if (result.length >= count) return result;
        }
      }
      break;
    }
  }

  // 2. Similar-length common words (easier to confuse)
  const similarLen = COMMON_WORDS.filter(
    (w) => Math.abs(w.length - len) <= 2 && w.toLowerCase() !== target && !exclude.has(w.toLowerCase())
  );
  const shuffled = [...similarLen].sort(() => Math.random() - 0.5);
  for (const w of shuffled) {
    if (!result.includes(w)) {
      result.push(w);
      if (result.length >= count) return result;
    }
  }

  // 3. Any common word if still need more
  for (const w of COMMON_WORDS) {
    const lower = w.toLowerCase();
    if (lower !== target && !exclude.has(lower) && !result.includes(w)) {
      result.push(w);
      if (result.length >= count) return result;
    }
  }

  return result;
}
