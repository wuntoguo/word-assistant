import { useState, useEffect } from 'react';

interface WordImageProps {
  word: string;
}

const imageCache = new Map<string, string | null>();

export default function WordImage({ word }: WordImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(
    imageCache.get(word.toLowerCase()) ?? null
  );
  const [loaded, setLoaded] = useState(false);
  const [tried, setTried] = useState(imageCache.has(word.toLowerCase()));

  useEffect(() => {
    const key = word.toLowerCase();
    if (imageCache.has(key)) {
      setImageUrl(imageCache.get(key) ?? null);
      setTried(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const url: string | null = data.thumbnail?.source || null;
        if (!cancelled) {
          imageCache.set(key, url);
          setImageUrl(url);
          setTried(true);
        }
      } catch {
        if (!cancelled) {
          imageCache.set(key, null);
          setImageUrl(null);
          setTried(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [word]);

  if (!tried || !imageUrl) return null;

  return (
    <div className="mt-4">
      <img
        src={imageUrl}
        alt={word}
        onLoad={() => setLoaded(true)}
        onError={() => { setImageUrl(null); }}
        className={`w-full max-h-48 object-contain rounded-xl bg-slate-50 transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {loaded && (
        <p className="text-xs text-slate-300 mt-1 text-right">via Wikipedia</p>
      )}
    </div>
  );
}
