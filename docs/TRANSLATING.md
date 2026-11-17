# Translating Folkbranch

Folkbranch is for families anywhere. The interface is written in English; every other language, Russian included, is one file, `locales/<code>.json`, that maps an English phrase to its own. This page is how to add a language, fix a phrase or review one. You do not need to read the code.

## How it works

- The **key of a phrase is its English text**: `t('Delete person')` looks up `"Delete person"` in the file of the language being read. A phrase a language has no line for shows in English, never in another language.
- **`lib/languages.ts` is the one list of languages**: code, name in itself, reading direction, plural rules, whether a name is written surname first, and the status (see below). Pickers, API checks, loaders and tests all read it.
- **Placeholders** are `{name}`, `{count}`, `{n}`; keep them exactly. **«Guillemets»** that the English has stay.
- **Plurals** use i18next's JSON v4 suffixes from the language's own rules (`Intl.PluralRules`): `"{count} years_one"`, `"_few"`, `"_many"`, `"_other"` (and `_zero`, `_two` for Arabic). `pnpm i18n:check` says which forms a language needs.
- **Two phrases with one English text** (a man's "Deceased" and a woman's) are told apart by a suffix: `Deceased_female`. The English still reads "Deceased"; a translation gives each its own sense.
- The browser loads only the language the person reads, on demand; the server reads a language's file the first time it writes in it.

## Add a language in ten minutes

1. `pnpm i18n:add pt-BR --name "Português (Brasil)" --open-end hoje --whisper portuguese`
   Add `--dir rtl` for a right-to-left language, `--surname-first` for one that writes the family name first, `--patronymic` where people carry one. It adds a line to `lib/languages.ts` (hidden from the pickers), `locales/pt-BR.json` with an empty line for every phrase, and `locales/glossary/pt-BR.md`.
2. Fill the **glossary** first: the form of address, the project terms (tree, person's card, archive, relative, event on the map, source, story, roles, invitation link, review) and anything a reader of that language would find wrong. Everyone translating works from it, so the same word always means the same thing.
3. Translate the lines. `pnpm i18n:batch pt-BR --count` shows how much is left; `--from 0 --to 100` prints the next phrases still missing in a range, with the Russian and Spanish for the exact sense; `--apply lines.json` merges a file of `{"English phrase": "translation"}` and refuses a line that loses a placeholder or a «quote». Several people can take different ranges.
4. `pnpm i18n:check` until it passes: no missing or unused phrase, the same placeholders and quotes as the English, every plural form the language needs. A line equal to the English, or far longer or shorter, is a warning to look at.
5. Set `openEnd` in the registry to the word for "now" in a range of years ("1950–now") and make the line `"now"` in the file say the same; a test keeps them equal.
6. Remove `hidden: true`. A language is listed in the picker only when it is complete.

A machine-translated language keeps `status: 'needs-review'`: the picker marks it **beta** until a native reader has gone through the long sentences (settings, data storage, privacy) and the kinship words, and the registry says `reviewed`. Their name and the date go at the end of the glossary.

## Right to left, fonts, names, relatives

- `dir: 'rtl'` in the registry sets the page's direction. Write new layout with logical CSS (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`), never `left`/`right`. Check it with `pnpm build && pnpm check:ui`, which also looks at the right-to-left screens.
- A language whose people write the surname first (`nameOrder: 'surname-first'`) is listed and sorted that way; `patronymic: true` shows a patronymic in the full name.
- Relatives (uncle, aunt, cousin, in-laws) are computed from the links, and a language only names them: add a table to `lib/kinship-words.ts`'s `KinWords` shape and list it in `KINSHIP_WORDS` in `lib/kinship.ts`. Many languages have a different word for a father's brother and a mother's brother; the `side` argument says which. Answer `''` for a relative the language has no single word for and `fallback` writes a phrase. Until a table exists, relatives are named in English. A native reader must confirm these words.
- A language the Whisper speech model knows gets `whisper: '<name>'`; without it Whisper detects the language itself.

## Writing code

- Wrap every word a person can read in `t()` with the English as the key. A sentence is one phrase with placeholders, never `t('Hello') + name`.
- `t()` takes a literal. A phrase that lives in a table is written `i18n('…')` so the extractor sees it. `pnpm i18n:check` fails on a new call whose phrase is not a literal.
- Never show a raw server or network error: map it through `errorFor` (`lib/i18n-errors.ts`) so the person reads it in their language.
- `pnpm i18n:pseudo` rewrites `locales/xx.json`, the pseudo-language (accented, wrapped in ⟦ ⟧, a third longer). A screen that shows plain English in it holds a phrase nobody wrapped.

## The checks

`pnpm i18n:check` (part of `pnpm check` and of CI) fails on: a phrase the code asks for with no line in a listed language; a line nothing asks for (`--prune` removes them); a duplicate key; a locale file the registry does not know; a changed `{placeholder}` or lost «quote»; a missing plural form; a new non-literal `t()` call. It warns on lines equal to the English and on length outliers, and prints a table of every language with its status.

## Moving the Russian-keyed code

The English keys came from a one-time codemod, `scripts/i18n-codemod.ts`, which can run again on a branch that still adds Russian phrases: put that branch's old tables (`lib/i18n.ts`, `lib/i18n-es.ts`, `lib/i18n-ca.ts`) into `scripts/legacy/`, run `node --import ./scripts/ts-register.mjs scripts/i18n-codemod.ts --write`, then `pnpm i18n:check --prune`. `pnpm i18n:parity` proves that every phrase reads exactly as before in Russian, English, Spanish and Catalan.
