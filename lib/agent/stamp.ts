// When an answer was given and how long the assistant worked on it. The server writes it into the message's metadata;
// the message keeps it in the saved conversation, so it is still there after a reload. Older messages have none.
import type { LanguageModelUsage } from 'ai'

export interface Stamp { at?: number; ms?: number; steps?: number; tokens?: number; usage?: LanguageModelUsage }

/** Builds the metadata of one answer as its stream goes by: the start, then the totals at the end. */
export function stampMaker(now: () => number = Date.now) {
  let began = 0, steps = 0
  return (part: { type: string; totalUsage?: LanguageModelUsage }): Stamp | undefined => {
    if (part.type === 'start') { began = now(); steps = 0; return { at: began } }
    if (part.type === 'finish-step') { steps++; return undefined }
    if (part.type !== 'finish') return undefined
    const u = part.totalUsage
    return { usage: u, ms: now() - began, steps, tokens: u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0) }
  }
}

/** What a message's metadata holds of it, or null for a message from before this existed. */
export function stampOf(meta: unknown): Stamp | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const s = { at: num(m.at), ms: num(m.ms), steps: num(m.steps), tokens: num(m.tokens) }
  return s.at === undefined ? null : s
}

/** "12 s", "1 min 5 s". */
export const duration = (ms: number, t: (k: string) => string) => {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s} ${t('сек')}` : `${Math.floor(s / 60)} ${t('мин')}${s % 60 ? ` ${s % 60} ${t('сек')}` : ''}`
}

/** The line under an answer, in the viewer's own way of writing the time: "14:32 · 12 s". */
export const stampLine = (s: Stamp, lang: string, t: (k: string) => string) =>
  [new Date(s.at!).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }), s.ms !== undefined && duration(s.ms, t)].filter(Boolean).join(' · ')

/** What opens under a long answer: how many steps it took and how many tokens it cost. Nothing for a short one. */
export const stampDetail = (s: Stamp, lang: string, t: (k: string) => string) =>
  s.steps && s.steps > 1 ? [`${t('шагов')}: ${s.steps}`, s.tokens ? `${t('токенов')}: ${s.tokens.toLocaleString(lang)}` : ''].filter(Boolean).join(' · ') : ''
