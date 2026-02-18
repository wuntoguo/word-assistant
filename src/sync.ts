import { useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  wordsAtom,
  tokenAtom,
  syncStatusAtom,
  lastSyncedAtAtom,
  lastSyncedAtWriteAtom,
  isOnlineAtom,
  userAtom,
  tokenWriteAtom,
} from './store';
import { syncWords, fetchCurrentUser } from './api';
import { Word } from './types';

function mergeServerWords(localWords: Word[], serverWords: Word[]): Word[] {
  const wordMap = new Map<string, Word>();

  for (const w of localWords) {
    wordMap.set(w.word.toLowerCase(), w);
  }

  for (const sw of serverWords) {
    const key = sw.word.toLowerCase();
    const local = wordMap.get(key);

    if (!local) {
      wordMap.set(key, sw);
    } else {
      wordMap.set(key, {
        ...local,
        id: local.id,
        memoryStage: Math.max(local.memoryStage, sw.memoryStage),
        reviewCount: Math.max(local.reviewCount, sw.reviewCount),
        nextReviewDate: sw.nextReviewDate,
        dateAdded: local.dateAdded < sw.dateAdded ? local.dateAdded : sw.dateAdded,
        definitions: local.definitions.length >= sw.definitions.length ? local.definitions : sw.definitions,
        examples: local.examples.length >= sw.examples.length ? local.examples : sw.examples,
        phonetic: local.phonetic || sw.phonetic,
        audioUrl: local.audioUrl || sw.audioUrl,
        partOfSpeech: local.partOfSpeech || sw.partOfSpeech,
        updatedAt: sw.updatedAt,
      });
    }
  }

  return Array.from(wordMap.values());
}

export function useSyncEngine() {
  const [words, setWords] = useAtom(wordsAtom);
  const token = useAtomValue(tokenAtom);
  const setSyncStatus = useSetAtom(syncStatusAtom);
  const lastSyncedAt = useAtomValue(lastSyncedAtAtom);
  const setLastSyncedAt = useSetAtom(lastSyncedAtWriteAtom);
  const setIsOnline = useSetAtom(isOnlineAtom);
  const setUser = useSetAtom(userAtom);
  const setToken = useSetAtom(tokenWriteAtom);

  // Use refs to always access latest values in async callbacks
  const wordsRef = useRef(words);
  const tokenRef = useRef(token);
  const lastSyncedAtRef = useRef(lastSyncedAt);
  const syncInProgressRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  wordsRef.current = words;
  tokenRef.current = token;
  lastSyncedAtRef.current = lastSyncedAt;

  const performSync = useCallback(async (forceFullSync = false) => {
    const currentToken = tokenRef.current;
    if (!currentToken || syncInProgressRef.current) return;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    syncInProgressRef.current = true;
    setSyncStatus('syncing');

    try {
      const currentWords = wordsRef.current;
      const currentLastSynced = forceFullSync ? null : lastSyncedAtRef.current;

      // Send all words on full sync, or only changed words on delta sync
      const changedWords = currentLastSynced
        ? currentWords.filter((w) => w.updatedAt > currentLastSynced)
        : currentWords;

      const response = await syncWords(currentLastSynced, changedWords);

      // Merge server changes into local (re-read latest words in case they changed during request)
      const latestWords = wordsRef.current;
      const merged = mergeServerWords(latestWords, response.serverWords);
      setWords(merged);

      setLastSyncedAt(response.syncedAt);
      setSyncStatus('synced');
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncStatus('error');
    } finally {
      syncInProgressRef.current = false;
    }
  }, [setSyncStatus, setLastSyncedAt, setWords]);

  // Manual sync: always do a full sync to catch any missed words
  const fullSync = useCallback(() => {
    performSync(true);
  }, [performSync]);

  const triggerSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      performSync();
    }, 2000);
  }, [performSync]);

  // Load user on mount if token exists
  useEffect(() => {
    if (!token) return;

    fetchCurrentUser()
      .then((user) => setUser(user))
      .catch(() => {
        setToken(null);
        setUser(null);
      });
  }, [token, setUser, setToken]);

  // Initial sync on mount
  useEffect(() => {
    if (token && navigator.onLine) {
      performSync();
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      performSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [performSync, setIsOnline, setSyncStatus]);

  // Periodic sync every 5 minutes
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      if (navigator.onLine) performSync();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [token, performSync]);

  return { triggerSync, performSync, fullSync };
}
