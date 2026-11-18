'use client'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'
import { FeatureGuide, type GuideSection } from './feature-guide'

/** Shown once to someone who has just come into the archive, so they know what it can do. It is always in the settings too. */
export function FeatureTour({ onClose, onGo }: { onClose: () => void; onGo: (section: GuideSection) => void }) {
  const { t } = useApp()
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-2xl flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="font-serif text-xl font-medium">{t('Welcome to the family archive')}</DialogTitle>
        <DialogDescription className="text-sm text-ink-soft">{t('A short look at what you can do here. You can always open it again: Settings → Features and tips.')}</DialogDescription>
        <FeatureGuide onGo={onGo} />
        <Button type="button" className="shrink-0 self-start" onClick={onClose}>{t('Got it')}</Button>
      </DialogContent>
    </Dialog>
  )
}
