const imageCheckCache = new Map<string, boolean>();

export async function checkWordHasImage(word: string): Promise<boolean> {
  const key = word.toLowerCase().trim();
  if (imageCheckCache.has(key)) return imageCheckCache.get(key)!;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`
    );
    if (!res.ok) {
      imageCheckCache.set(key, false);
      return false;
    }
    const data = await res.json();
    const has = !!(data.thumbnail?.source);
    imageCheckCache.set(key, has);
    return has;
  } catch {
    imageCheckCache.set(key, false);
    return false;
  }
}
