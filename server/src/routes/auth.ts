import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { findUserByProvider, createUser, findUserById } from '../db.js';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Helper: issue JWT
function issueToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

// Middleware: verify JWT and attach userId to req
export function authMiddleware(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ==================== Google OAuth ====================

// Step 1: Redirect to Google
authRouter.get('/google', (_req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
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
    const profile = await userRes.json() as { id: string; email: string; name: string; picture: string };

    // Find or create user
    let user = findUserByProvider('google', profile.id);
    if (!user) {
      user = createUser({
        id: uuidv4(),
        email: profile.email,
        name: profile.name,
        avatar_url: profile.picture,
        provider: 'google',
        provider_id: profile.id,
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
    if (!user) {
      user = createUser({
        id: uuidv4(),
        email,
        name: profile.name || profile.login,
        avatar_url: profile.avatar_url,
        provider: 'github',
        provider_id: profile.id.toString(),
      });
    }

    const token = issueToken(user.id);
    res.redirect(`${APP_URL}/#/auth-callback?token=${token}`);
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.status(500).json({ error: 'GitHub OAuth failed' });
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
