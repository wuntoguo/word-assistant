import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { tokenWriteAtom } from '../store';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setToken = useSetAtom(tokenWriteAtom);
  const [error, setError] = useState<string | null>(null);

  const resolveToken = (): string | null => {
    const fromSearch = searchParams.get('token');
    if (fromSearch) return fromSearch;

    const hash = window.location.hash || '';
    const fromHash = hash.match(/[?&]token=([^&]+)/)?.[1];
    if (fromHash) return decodeURIComponent(fromHash);

    const href = window.location.href || '';
    const fromHref = href.match(/[?&#]token=([^&#]+)/)?.[1];
    if (fromHref) return decodeURIComponent(fromHref);

    return null;
  };

  useEffect(() => {
    const token = resolveToken();
    if (token) {
      setToken(token);
      setError(null);
      navigate('/', { replace: true });
      return;
    }
    setError('Sign-in callback did not contain a token. Please try login again.');
  }, [searchParams, setToken, navigate]);

  return (
    <div className="max-w-md mx-auto text-center py-20">
      {!error ? (
        <>
          <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-500">Logging you in...</p>
        </>
      ) : (
        <>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Back to Login
          </button>
        </>
      )}
    </div>
  );
}
