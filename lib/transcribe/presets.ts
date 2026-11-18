// The speech services an owner can connect for cloud transcription. Plain data, so the browser shows them too.
export type SttId = 'openrouter' | 'groq' | 'openai' | 'mistral' | 'siliconflow' | 'custom'

export interface SttPreset {
  id: SttId
  label: string
  /** Where the audio goes: shown to everyone before they use it. */
  where: string
  base: string
  /** openai: a file in a form, as OpenAI does it. openrouter: base64 in JSON. */
  style: 'openai' | 'openrouter'
  keysUrl: string
  pitch: string
  /** The first is the default. Prices are dollars per minute of audio as the service listed them in November 2026, a guide that changes. */
  models: { id: string; label: string; perMinute: number | null; note?: string }[]
  /** Billed at least this many seconds for each request. */
  minSeconds?: number
  /** Free plan and what it costs in data, from the service's own terms on 8 November 2026; null when there is none or it is not known. */
  /** What our own run found, when there was one: services without it are shown as not tested. */
  tested?: string
  free?: { data: 'private' | 'trains' | 'mixed' | 'unknown'; note: string }
  /** The key of the assistant, when that is the same service, can be reused. */
  assistantKey?: 'openrouter' | 'openai'
}

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'openrouter', label: 'OpenRouter', where: 'OpenRouter and the service it picks for the model', base: 'https://openrouter.ai/api/v1', style: 'openrouter', keysUrl: 'https://openrouter.ai/settings/keys', assistantKey: 'openrouter',
        pitch: 'Understands Russian best',
    models: [
      { id: 'mistralai/voxtral-mini-transcribe', label: 'Voxtral Mini (Mistral)', perMinute: 0.003, note: 'Cheap and accurate, many languages' },
      { id: 'openai/whisper-large-v3', label: 'Whisper large-v3', perMinute: null },
      { id: 'microsoft/mai-transcribe-2', label: 'MAI-Transcribe 2 (Microsoft)', perMinute: null, note: 'One of the most accurate' },
    ],
  },
  {
    id: 'groq', label: 'Groq', where: 'Groq (USA)', base: 'https://api.groq.com/openai/v1', style: 'openai', keysUrl: 'https://console.groq.com/keys', minSeconds: 10,
        free: { data: 'private', note: 'Free allowance, recordings are not used.' },
    pitch: 'The cheapest, understands Russian worse',
    models: [
      { id: 'whisper-large-v3-turbo', label: 'Whisper large-v3 turbo', perMinute: 0.04 / 60, note: 'About 4.6% errors in English' },
      { id: 'whisper-large-v3', label: 'Whisper large-v3', perMinute: 0.111 / 60, note: 'Slightly more accurate for rare languages' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', where: 'OpenAI (USA)', base: 'https://api.openai.com/v1', style: 'openai', keysUrl: 'https://platform.openai.com/api-keys', assistantKey: 'openai',
    pitch: 'Accurate, but pricier',
    models: [{ id: 'gpt-transcribe', label: 'GPT Transcribe', perMinute: 0.0045 }],
  },
  {
    id: 'mistral', label: 'Mistral (Voxtral)', where: 'Mistral AI (France)', base: 'https://api.mistral.ai/v1', style: 'openai', keysUrl: 'https://console.mistral.ai/api-keys',
    free: { data: 'trains', note: 'Free, but the company uses your recordings.' },
    pitch: 'An affordable European service',
    // Mistral's docs list voxtral-mini-transcribe-3 and voxtral-small-transcribe-3; the old -latest id is gone.
    models: [
      { id: 'voxtral-mini-transcribe-3', label: 'Voxtral Mini Transcribe 3', perMinute: 0.0035 },
      { id: 'voxtral-small-transcribe-3', label: 'Voxtral Small Transcribe 3', perMinute: 0.004, note: 'More accurate, more expensive' },
    ],
  },
  {
    id: 'siliconflow', label: 'SiliconFlow (China)', where: 'SiliconFlow (China, Singapore)', base: 'https://api.siliconflow.com/v1', style: 'openai', keysUrl: 'https://cloud.siliconflow.com/account/ak',
    free: { data: 'unknown', note: 'Free, but the terms are unclear.' },
    pitch: 'A Chinese service with free models',
    // SiliconFlow's API reference lists only these two models for /audio/transcriptions.
    models: [
      { id: 'FunAudioLLM/SenseVoiceSmall', label: 'SenseVoice Small', perMinute: 0, note: 'Chinese, English, Japanese, Korean' },
      { id: 'TeleAI/TeleSpeechASR', label: 'TeleSpeech ASR', perMinute: 0, note: 'Chinese and dialects' },
    ],
  },
  {
    id: 'custom', label: 'Your own server', where: 'the server the owner named', base: '', style: 'openai', keysUrl: '',
    pitch: 'Your own server: the recording never leaves your network',
    models: [{ id: 'whisper-1', label: 'Model name on your server', perMinute: null }],
  },
]

export const sttPreset = (id: string) => STT_PRESETS.find((p) => p.id === id)
