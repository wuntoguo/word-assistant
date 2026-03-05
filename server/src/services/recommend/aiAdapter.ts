import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export async function getEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  if (!text?.trim()) return [];
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return res.data[0]?.embedding ?? [];
}

export async function computeSemanticInterestScore(
  openai: OpenAI,
  userEmbedding: number[],
  articleTitle: string,
  articleKeywords: string[],
  articleExcerpt: string
): Promise<number> {
  const articleText = [articleTitle, articleKeywords.join(', '), articleExcerpt.slice(0, 500)]
    .filter(Boolean)
    .join(' ');
  if (userEmbedding.length === 0 || !articleText.trim()) return 50;

  const articleEmb = await getEmbedding(openai, `Article: ${articleText}`);
  const sim = cosineSimilarity(userEmbedding, articleEmb);
  return Math.round(Math.max(0, Math.min(100, (sim + 1) * 50)));
}

export async function buildInterestReason(
  openai: OpenAI,
  profileInterests: string[],
  profileDislikes: string[],
  keywords: string[],
  articleTitle: string,
  excerpt: string
): Promise<string> {
  const sys = `You provide a brief interest match reason for an English learner. Output valid JSON only.
Format: { "interestReason": "one sentence in English - why this article matches user interests" }
User interest topics: ${profileInterests.join(', ') || 'none yet'}
Topics to avoid (user disliked): ${profileDislikes.join(', ') || 'none'}
Article topics: ${keywords.join(', ')}`;

  const userContent = `Article: ${articleTitle}\nExcerpt: ${excerpt.slice(0, 300)}\n\nGenerate interestReason.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      max_tokens: 100,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw.replace(/```\w*\n?|\n?```/g, '')) as { interestReason?: string };
    return parsed.interestReason || '';
  } catch {
    return '';
  }
}
