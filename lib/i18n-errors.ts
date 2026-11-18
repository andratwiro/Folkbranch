// The server's short protocol errors stay in English for programs (MCP clients, tokens, tests match on them).
// A person in the app reads them in their own language: each message is a phrase in locales/<code>.json, like any other.
import { translate } from './i18n'
import type { Lang } from './types'

/** The person's wording of a protocol error, or the error as it is when their language has none. */
export const errorFor = (message: string, lang: Lang) => translate(lang, message)
