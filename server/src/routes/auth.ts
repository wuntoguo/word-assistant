import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { findUserByProvider, createUser, findUserById, findUserByEmail, findAnyUserByEmail } from '../repositories/userRepo.js';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-secret';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) return false;
  if (domain.startsWith('-') || domain.endsWith('-') || domain.includes('..')) return false;
  if (!domain.includes('.')) return false;
  return true;
}

// Helper: issue JWT
function issueToken(userId: string): string {
  return jwt.sign({ userId }, EFFECTIVE_JWT_SECRET, { expiresIn: '30d' });
}

// Middleware: verify JWT and attach userId to req
export function authMiddleware(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), EFFECTIVE_JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth: attach userId if token valid, else continue without (no 401)
export function optionalAuthMiddleware(req: Request, _res: Response, next: () => void) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next();
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), EFFECTIVE_JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
  } catch {
    // ignore invalid token
  }
  next();
}

// ==================== Google OAuth ====================

authRouter.get('/providers', (_req: Request, res: Response) => {
  res.json({
    email: true,
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
});

// Step 1: Redirect to Google
authRouter.get('/google', (_req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Google OAuth not configured' });
    return;
  }

  const redirectUri = `${APP_URL}/api/auth/google/callback`;
  const scope = encodeURIComponent('openid email profile');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

  res.redirect(url);
});

// Step 2: Google callback
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code) {
    res.status(400).json({ error: 'No code provided' });
    return;
  }

  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      res.status(500).json({ error: 'Google OAuth not configured' });
      return;
    }
    const redirectUri = `${APP_URL}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokens.access_token) {
      res.status(400).json({ error: 'Failed to get Google token', details: tokens });
      return;
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json() as { id: string; email?: string; name?: string; picture?: string };
    if (!profile.id || !profile.email || !isValidEmail(profile.email)) {
      res.status(400).json({ error: 'Google account email is unavailable or invalid' });
      return;
    }
    const normalizedEmail = normalizeEmail(profile.email);

    // Find or create user
    let user = findUserByProvider('google', profile.id);
    if (!user) {
      const existingByEmail = findAnyUserByEmail(normalizedEmail);
      if (existingByEmail) {
        // Single-user-account policy: same verified email maps to one user,
        // regardless of OAuth provider.
        user = existingByEmail;
      }
    }
    if (!user) {
      user = createUser({
        id: uuidv4(),
        email: normalizedEmail,
        name: (profile.name || normalizedEmail.split('@')[0]).trim(),
        avatar_url: profile.picture || null,
        provider: 'google',
        provider_id: profile.id,
        password_hash: null,
      });
    }

    const token = issueToken(user.id);
    // Redirect to frontend with token in hash
    res.redirect(`${APP_URL}/#/auth-callback?token=${token}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.status(500).json({ error: 'Google OAuth failed' });
  }
});

// ==================== GitHub OAuth ====================

// Step 1: Redirect to GitHub
authRouter.get('/github', (_req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'GitHub OAuth not configured' });
    return;
  }

  const redirectUri = `${APP_URL}/api/auth/github/callback`;
  const scope = 'read:user user:email';
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;

  res.redirect(url);
});

// Step 2: GitHub callback
authRouter.get('/github/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code) {
    res.status(400).json({ error: 'No code provided' });
    return;
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokens = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokens.access_token) {
      res.status(400).json({ error: 'Failed to get GitHub token', details: tokens });
      return;
    }

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
    });
    const profile = await userRes.json() as { id: number; login: string; email: string | null; name: string | null; avatar_url: string };

    // Get email if not public
    let email = profile.email;
    if (!email) {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
      });
      const emails = await emailRes.json() as Array<{ email: string; primary: boolean }>;
      const primary = emails.find((e) => e.primary);
      email = primary?.email || emails[0]?.email || null;
    }

    // Find or create user
    let user = findUserByProvider('github', profile.id.toString());
    if (!user && email) {
      const existingByEmail = findAnyUserByEmail(email);
      if (existingByEmail) {
        user = existingByEmail;
      }
    }
    if (!user) {
      user = createUser({
        id: uuidv4(),
        email,
        name: profile.name || profile.login,
        avatar_url: profile.avatar_url,
        provider: 'github',
        provider_id: profile.id.toString(),
        password_hash: null,
      });
    }

    const token = issueToken(user.id);
    res.redirect(`${APP_URL}/#/auth-callback?token=${token}`);
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.status(500).json({ error: 'GitHub OAuth failed' });
  }
});

// ==================== Email + Password Auth ====================

authRouter.post('/register', async (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  if (password.length < 4) {
    res.status(400).json({ error: 'Password must be at least 4 characters' });
    return;
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = findAnyUserByEmail(normalizedEmail);
  if (existing) {
    if (existing.provider === 'email') {
      res.status(409).json({ error: 'This email is already registered. Please sign in.' });
      return;
    }
    res.status(409).json({ error: `This email is linked to ${existing.provider}. Please use that sign-in method.` });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = createUser({
      id: uuidv4(),
      email: normalizedEmail,
      name: name?.trim() || normalizedEmail.split('@')[0],
      avatar_url: null,
      provider: 'email',
      provider_id: normalizedEmail,
      password_hash: passwordHash,
    });

    const token = issueToken(user.id);
    res.json({ token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  const user = findUserByEmail(normalizedEmail);
  const anyUser = findAnyUserByEmail(normalizedEmail);

  if (!user || !user.password_hash) {
    if (anyUser && anyUser.provider !== 'email') {
      res.status(400).json({ error: `This email uses ${anyUser.provider} sign-in. Please continue with ${anyUser.provider}.` });
      return;
    }
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  try {
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = issueToken(user.id);
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== User Info ====================

authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const user = findUserById(userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    provider: user.provider,
  });
});
