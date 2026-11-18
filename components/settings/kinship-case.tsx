'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'

interface Preview { people: number; already: number; updated: number; parents: number; unions: number; proved: number; candidates: number; openRelations: number; leftOut: number; living: number; disputed: number; broken: number; trimmed: number }
interface Files { caseId: string; persons: string; relationships?: string; claims?: string; artifacts?: string }

const NAMES: Record<string, keyof Files> = { 'person-register.csv': 'persons', 'relationship-register.csv': 'relationships', 'claims-register.csv': 'claims', 'artifact-register.csv': 'artifacts' }
const depth = (f: File) => f.webkitRelativePath.split('/').length

/** A folder from the kinship research skill: what was proved goes on the chart, the rest stays a note on the card. */
export function KinshipCase() {
  const { t, notify, undoLast } = useApp()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Files | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = async (list: File[]) => {
    setError('')
    setPreview(null)
    setFiles(null)
    // The case's own registers, not a copy in a subfolder.
    const near = [...list].sort((a, b) => depth(a) - depth(b))
    const read: Partial<Files> = {}
    for (const f of near) {
      const key = NAMES[f.name]
      if (key && !read[key]) read[key] = await f.text()
    }
    if (!read.persons) return setError(t('This folder has no person-register.csv. Choose a case folder.'))
    const intake = near.find((f) => f.name === 'case-intake.yaml')
    const named = intake && /^case_id:\s*["']?([^"'\n#]*)/m.exec(await intake.text())?.[1].trim()
    read.caseId = named || near[0].webkitRelativePath.split('/')[0] || near[0].name
    try {
      setPreview(await api<Preview>('case/preview', { json: read }))
      setFiles(read as Files)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    }
  }
  const run = async () => {
    setBusy(true)
    try {
      await api('case/import', { json: files })
      await qc.invalidateQueries()
      notify(t('Case added'), [{ label: t('Undo'), run: () => void undoLast() }])
      setFiles(null)
      setPreview(null)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('Add a research case')} description={t('A folder of family research made with ex-ussr-kinship-research. Possible relatives stay separate cards, and unproved relations stay notes, off the chart.')}>
      {/* @ts-expect-error the browser's folder picker has no type in React */}
      <input ref={input} type="file" webkitdirectory="" multiple hidden aria-label={t('Choose the case folder')} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void pick(list) }} />
      <Button variant="outline" className="self-start" onClick={() => input.current?.click()}><FolderOpen /> {t('Choose the case folder')}</Button>
      {preview && (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-xs leading-snug">
          <p>{t('New cards')}: <b>{preview.people}</b>. {t('Living or unknown among them')}: {preview.living}. {t('Candidates')}: {preview.candidates}.</p>
          {preview.already > 0 && <p>{t('Already in the archive')}: {preview.already}. {t('Will gain new details')}: {preview.updated}. {t('What you wrote will not be replaced')}.</p>}
          <p>{t('Parent and child lines on the chart')}: {preview.parents}, {t('couples')}: {preview.unions}.{preview.proved > 0 ? ` ${t('Relations that become confirmed')}: ${preview.proved}.` : ''}</p>
          <p>{t('Relations kept as notes')}: {preview.openRelations}. {t('Rejected in the case, left out')}: {preview.leftOut}.</p>
          {preview.disputed > 0 && <p className="text-rust">⚠ {t('The case contradicts relations already on the chart. They stay, so check them yourself')}: {preview.disputed}</p>}
          {preview.broken > 0 && <p className="text-rust">⚠ {t('Relations with people missing from the case list will not come over')}: {preview.broken}</p>}
          {preview.trimmed > 0 && <p className="text-rust">⚠ {t('Cards that did not fit whole were shortened')}: {preview.trimmed}</p>}
          <Button size="sm" className="mt-1 self-start" disabled={busy || !(preview.people || preview.updated || preview.parents || preview.unions || preview.proved)} onClick={run}><Upload /> {t('Add to the archive')}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </Section>
  )
}
