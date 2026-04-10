/**
 * Vercel serverless function — AI Gateway proxy.
 *
 * Authenticates the user via Supabase JWT, enforces a daily rate limit,
 * and forwards the prompt to Vercel AI Gateway using the official AI SDK.
 * The AI_GATEWAY_API_KEY env var never reaches the client.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

/** Max AI requests per user per day (free tier). */
const DAILY_LIMIT = 20;

/** In-memory rate limit store. Resets when the function cold-starts.
 *  For a real production app, use Redis or a DB table. */
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetAt) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    rateLimits.set(userId, { count: 1, resetAt: tomorrow.getTime() });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth: verify Supabase JWT ---
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // --- Rate limit ---
  const { allowed, remaining } = checkRateLimit(user.id);
  res.setHeader('X-RateLimit-Remaining', remaining.toString());

  if (!allowed) {
    return res.status(429).json({
      error: `Daily limit reached (${DAILY_LIMIT} requests/day). Use your own API key in Settings for unlimited access.`,
    });
  }

  // --- Validate request ---
  const { prompt, model } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" in request body' });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return res.status(500).json({ error: 'AI Gateway is not configured on this server.' });
  }

  // --- Generate via Vercel AI Gateway ---
  const aiModel = model || 'openai/gpt-4o-mini';

  try {
    const { text } = await generateText({
      model: gateway(aiModel),
      prompt,
      temperature: 0.3,
    });

    if (!text) {
      return res.status(502).json({ error: 'Empty response from AI Gateway' });
    }

    return res.status(200).json({ text, remaining });
  } catch (e: any) {
    const message = e.message || 'Unknown error';
    const truncated = message.length > 300 ? message.slice(0, 300) + '…' : message;
    return res.status(500).json({ error: `AI error: ${truncated}` });
  }
}
