// How each service keeps what the archive sends it, from its own documents, read on 16 Nov 2026. These texts age:
// the date is shown with them, and each names its source so the owner can read the current terms.
export const TERMS_CHECKED = '2026-11-16'

export interface Terms { trains: string; keeps: string; where: string; tip?: string; source: string }

export const DATA_TERMS: Record<string, Terms> = {
  openrouter: { trains: 'OpenRouter itself does not train on requests. The app asks only for providers that do not collect data', keeps: 'Does not keep request text, only service data: token counts, timing', where: 'USA and the chosen provider\'s country', source: 'https://openrouter.ai/docs/guides/privacy/data-collection' },
  anthropic: { trains: 'Does not train on API requests', keeps: 'Up to 30 days; policy violations up to 2 years', where: 'Not given', source: 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data' },
  openai: { trains: 'Has not trained on API requests since March 2023', keeps: 'Chat up to 30 days for abuse checks; transcription is not kept', where: 'Not given', source: 'https://platform.openai.com/docs/guides/your-data' },
  google: { trains: 'On the paid tier it does not train. On the free tier it uses requests to improve, and staff may read them', keeps: 'Paid tier: 55 days for abuse checks', where: 'Any country where Google has servers', tip: 'Use a key from a project with billing turned on', source: 'https://ai.google.dev/gemini-api/terms' },
  yandex: { trains: 'By default keeps requests and may train on them. The app asks it not to, in every request', keeps: 'With logging off, only while answering', where: 'Not given', source: 'https://aistudio.yandex.ru/en/docs/ai-studio/operations/disable-logging' },
  cloudru: { trains: 'Cloud.ru\'s own models are not trained on your data. Outside models (DeepSeek, Qwen and others) follow their owners\' rules', keeps: 'Period not stated', where: 'Own models on Cloud.ru servers in Russia; outside models on their owners\' servers', tip: 'Choose models hosted by Cloud.ru itself', source: 'https://cloud.ru/documents/contracts/terms-of-service/evolution/foundation-models/description-foundation-models' },
  deepseek: { trains: 'The API terms give no right to train on requests; the service\'s general policy allows it', keeps: 'Period not stated', where: 'China', source: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html' },
  moonshot: { trains: 'The sources disagree: the help page says no, the terms allow it', keeps: 'While the account exists; no keeping only by a company agreement', where: 'Singapore', source: 'https://platform.moonshot.ai/docs/agreement/userprivacy' },
  groq: { trains: 'Does not train on requests', keeps: 'Does not keep; up to 30 days only when looking into a failure or abuse', where: 'USA', tip: 'In the Groq console you can turn off all keeping (Data Controls)', source: 'https://console.groq.com/docs/your-data' },
  mistral: { trains: 'Does not train on API requests; the organisation settings have a separate switch: check it is off', keeps: 'Period not stated; no keeping on request', where: 'Not given', source: 'https://docs.mistral.ai/admin/security-access/privacy' },
  siliconflow: { trains: 'Not given', keeps: 'Period not stated', where: 'Not stated; the company is in Singapore and China', source: 'https://docs.siliconflow.com/en/legals/privacy-policy' },
  rekognition: { trains: 'By default may keep photos and use them to improve the service', keeps: 'Period not stated', where: 'The chosen AWS region', tip: 'In AWS Organizations turn on the AI services opt-out policy for Rekognition', source: 'https://docs.aws.amazon.com/rekognition/latest/dg/security-data-encryption.html' },
  facepp: { trains: 'The terms allow keeping the data sent for internal research', keeps: 'Deletes original photos right after answering; logs at least 6 months', where: 'China or Canada', source: 'https://faceplusplus.com/privacy-policy' },
  luxand: { trains: 'Not given', keeps: 'Face templates and photos up to a year after the last use, at most 3 years', where: 'USA', tip: 'The keeping period can be shortened in the Luxand account settings', source: 'https://luxand.com/privacy' },
  compreface: { trains: 'No: it is your own server', keeps: 'Only on your server', where: 'Your server', source: 'https://github.com/exadel-inc/CompreFace' },
}
