import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { tokenWriteAtom } from '../store';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setToken = useSetAtom(tokenWriteAtom);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setToken(token);
    }
    navigate('/', { replace: true });
  }, [searchParams, setToken, navigate]);

  return (
    <div className="max-w-md mx-auto text-center py-20">
      <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
      <p className="text-slate-500">Logging you in...</p>
    </div>
  );
}
