// The providers a person can connect from the app. Plain data, so the browser can show them too.
export type PresetId = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'yandex' | 'cloudru' | 'deepseek' | 'moonshot'

/**
 * Only cheap models are offered: about the price of DeepSeek Flash, up to $0.20 per million tokens in and $1 out.
 * A service whose models are all dearer is kept for those who connected it already, but is not offered to new ones.
 */
export interface Preset {
  id: PresetId
  hidden?: boolean
  label: string
  /** Its logo in components/brand-icons.tsx. */
  icon?: 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'yandex' | 'deepseek'
  /** Where the service is based, for the list's grouping. */
  region: 'world' | 'ru' | 'cn'
  /** The key alone is not enough: the service also wants the account's folder. */
  folder?: boolean
  /** Where the key is made. */
  keysUrl: string
  pitch: string
  /** What the second step means at this provider. */
  howTo: string
  /** The first is the default: cheap and fast. Anything dearer is only ever the person's own choice. */
  models: PresetModel[]
}

/** Prices are per million tokens as listed by each service in November 2026 (dollars, or roubles at the Russian ones), as a guide: they change often. */
export interface PresetModel { id: string; label: string; price: string; note?: string }

export const PRESETS: Preset[] = [
  { id: 'openrouter', region: 'world', icon: 'openrouter', label: 'OpenRouter', keysUrl: 'https://openrouter.ai/settings/keys', pitch: 'One key for many models. The easiest place to start', howTo: 'Sign in, press “Create API key” and add money on the Credits page', models: [{ id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50', note: 'A good choice for most people' }, { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', price: '$0.15 / $0.60', note: 'The cheapest, but its developer may use your texts' }, { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', price: '$0.075 / $0.30', note: 'Reliable, but a little pricier' }, { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash', price: '$0.03–0.15 / $0.10–0.50', note: 'Very cheap, but sometimes slow to answer' }, { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50', note: 'Careful, but pricier' }] },
{ id: 'anthropic', region: 'world', icon: 'anthropic', label: 'Anthropic (Claude)', keysUrl: 'https://platform.claude.com/settings/keys', pitch: '', howTo: 'Sign in, press “Create Key” and add money under Billing. A Claude subscription does not work here', models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50' }] },
  { id: 'openai', region: 'world', icon: 'openai', label: 'OpenAI (ChatGPT)', keysUrl: 'https://platform.openai.com/api-keys', pitch: '', howTo: 'Sign in, press “Create new secret key” and add money under Billing. A ChatGPT subscription does not work here', models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50' }, { id: 'gpt-6-luna-pro', label: 'GPT-6 Luna Pro', price: '$0.10 / $0.50' }] },
  { id: 'google', hidden: true, region: 'world', icon: 'gemini', label: 'Google (Gemini)', keysUrl: 'https://aistudio.google.com/app/apikey', pitch: '', howTo: 'Sign in and press “Create API key”', models: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', price: '$0.30 / $2.50' }, { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', price: '$0.75 / $3.75', note: 'Stronger, but 2.5 times the price' }] },
  { id: 'yandex', region: 'ru', icon: 'yandex', label: 'Yandex AI Studio', keysUrl: 'https://aistudio.yandex.cloud/platform/', pitch: 'A Russian service: pay in roubles, servers in Russia', howTo: 'Sign in, press “Create API key” and copy the key. The folder ID is shown in the Yandex Cloud console next to the folder name', folder: true, models: [{ id: 'yandexgpt/latest', label: 'YandexGPT', price: 'in roubles, see Yandex’s rates' }, { id: 'aliceai-llm/latest', label: 'Alice AI', price: 'in roubles, see Yandex’s rates' }] },
  { id: 'cloudru', region: 'ru', label: 'Cloud.ru (GigaChat)', keysUrl: 'https://console.cloud.ru/', pitch: 'A Russian service: pay in roubles, and Sber’s GigaChat models are here', howTo: 'In the console open Foundation Models, create an API key and copy it', models: [{ id: 'GigaChat/GigaChat-3-Pro', label: 'GigaChat 3 Pro', price: '73 ₽ / 176 ₽' }, { id: 'ai-sage/GigaChat3.5-432B-A28B-Reasoning', label: 'GigaChat 3.5 432B', price: '96 ₽ / 289 ₽', note: 'Sber’s strongest model' }] },
  { id: 'deepseek', region: 'cn', icon: 'deepseek', label: 'DeepSeek', keysUrl: 'https://platform.deepseek.com/api_keys', pitch: 'A Chinese service with low prices', howTo: 'Sign in, press “Create new API key” and top up the balance', models: [{ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', price: '$0.15–0.30 / $0.60–1.20', note: 'Half the price at night and at weekends' }] },
  { id: 'moonshot', hidden: true, region: 'cn', label: 'Moonshot (Kimi)', keysUrl: 'https://platform.kimi.ai/console/api-keys', pitch: 'A Chinese service. The key is from the international platform, not the Chinese one', howTo: 'Sign in, top up at least $1 and press “Create API key”', models: [{ id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', price: '$2 / $10' }] },
]
