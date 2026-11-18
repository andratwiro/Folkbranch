import type { Plans } from './lines'
import type { PresetId } from './presets'

/** Said plainly, for the page that chooses a service. A service missing here is shown without a claim about its free plan. */
export const ASSISTANT_PLANS: Partial<Record<PresetId, Plans>> = {
  openrouter: { free: { data: 'mixed', note: 'A few models are free, but some may use your texts.' }, paid: 'Paid, your texts are not used' },
  anthropic: { free: null, paid: 'Paid only, your texts are not used' },
  openai: { free: null, paid: 'Paid only, your texts are not used' },
  google: { free: { data: 'trains', note: 'Free for light models, but Google uses your texts.' }, paid: 'Paid, your texts are not used' },
}
