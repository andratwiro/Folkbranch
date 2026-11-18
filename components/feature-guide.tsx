'use client'
import { Baby, CalendarDays, Cloud, FileUp, GitMerge, History, Lightbulb, Link2, Map, Mic, MousePointer2, Printer, ScanFace, Share2, Smartphone, Sparkles, Terminal, UsersRound, type LucideIcon } from 'lucide-react'
import { useApp } from '@/lib/client'

export type GuideSection = 'speech' | 'faces' | 'setup' | 'account' | 'smart' | 'general' | 'people' | 'signin' | 'assistant' | 'agents' | 'data'

interface Feature { icon: LucideIcon; title: string; text: string; go?: { section: GuideSection; label: string; owner?: boolean } }

/** What the app can do, in the words a relative would use. Each card can lead to where it is switched on. */
const FEATURES: Feature[] = [
  { icon: Sparkles, title: 'AI assistant', text: 'Ask “who are my cousins?” or “where are the gaps in the Sokolov line?”. It searches the archive and suggests changes, and you confirm each one. It needs your own key from one of the services.', go: { section: 'assistant', label: 'Connect', owner: true } },
  { icon: Share2, title: 'Invite relatives', text: 'An invitation link lets a person into the archive. A view link shows the family without signing in, and can show just one branch.', go: { section: 'people', label: 'Invite', owner: true } },
  { icon: ScanFace, title: 'Faces in photos', text: 'Name a person in one photo and the program offers them in the others, even at another age. It all runs on your device; photos go nowhere.', go: { section: 'smart', label: 'Turn on' } },
  { icon: Mic, title: 'Voice to text', text: 'Record a grandmother telling a story and it becomes text. The model can be downloaded to the device. Or the owner connects a cloud service once and pays, and nobody else has to install anything.', go: { section: 'smart', label: 'Choose a way' } },
  { icon: Cloud, title: 'Cloud transcription', text: 'One speech recognition service for everyone: Groq, OpenAI, Mistral, OpenRouter, the Chinese SiliconFlow or your own server. The key is entered once, and each month has a spending limit.', go: { section: 'speech', label: 'Connect', owner: true } },
  { icon: ScanFace, title: 'Cloud faces_short', text: 'One face recognition service for everyone: Amazon Rekognition, Face++, Luxand.cloud or your own CompreFace. The key is entered once, each month has a spending limit, and no model needs downloading.', go: { section: 'faces', label: 'Connect', owner: true } },
  { icon: Baby, title: 'Ask relatives to tell a story', text: 'A link for one person who will not sign up: open it on a phone, press the big button and speak. The story comes to you for review.', go: { section: 'people', label: 'Create a link', owner: true } },
  { icon: FileUp, title: 'A tree with its photos', text: 'Load the tree file (GEDCOM, Gramps, a table or text) and all the photos at once. Files find their people by what the tree says and by the file names.', go: { section: 'data', label: 'Load' } },
  { icon: Map, title: 'Map of places', text: 'Where the family lived and where it moved. On a person\'s card the places follow the order of their life.' },
  { icon: CalendarDays, title: 'Dates and calendar', text: 'Coming birthdays and anniversaries, and a file for your phone\'s calendar so nobody forgets to call.' },
  { icon: GitMerge, title: 'Duplicates', text: 'Similar cards are gathered in Review. Merge them: nothing is lost, and one action brings it all back.' },
  { icon: History, title: 'History and undo', text: 'Every change shows who made it, when, and what. Any of them can be undone, an import included.' },
  { icon: Printer, title: 'Printing and the ancestor fan', text: 'A sheet about a person to print or save as PDF, a chart as a fan of ancestors, and the whole chart prints on sheets.' },
  { icon: Terminal, title: 'Outside programs', text: 'Claude, Codex and other programs connect with a key, read the archive and suggest changes. Nothing changes without your confirmation.', go: { section: 'agents', label: 'Connect', owner: true } },
]

/** Things most people never find on their own. */
const TIPS: { icon: LucideIcon; text: string }[] = [
  { icon: MousePointer2, text: 'Right-click. On a person: open, add a parent, spouse or child, delete. On empty space: add a person there, load a file, search.' },
  { icon: Link2, text: 'Hover over a person and their whole line lights up, ancestors and descendants.' },
  { icon: UsersRound, text: 'The “Who to show” button keeps one branch on the chart, and all lists, search and dates then show only that branch. A view can be saved and sent as a link.' },
  { icon: Lightbulb, text: 'Drag a portrait to another card to make a link. Drag the caption to move the card; the relationship does not change.' },
  { icon: FileUp, text: 'Drop a tree file straight onto the chart to start loading it. Photos can come along.' },
  { icon: Smartphone, text: 'Add the archive to your phone\'s home screen: it opens like an app, and the page waits out a short server outage.' },
  { icon: Lightbulb, text: 'Search looks through names, dates, places and professions, and understands phrases like “Ivan\'s wife”.' },
  { icon: Lightbulb, text: 'When sources disagree, do not pick one: record both values. They are kept as versions, and later you can see which one held.' },
]

export function FeatureGuide({ onGo }: { onGo?: (section: GuideSection) => void }) {
  const { t, me } = useApp()
  const owner = me.role === 'owner'
  return (
    <div className="flex min-w-0 flex-col gap-5 text-sm">
      <section>
        <h3 className="mb-2 font-serif text-base font-medium">{t('What the app can do')}</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text, go }) => (
            <li key={title} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-white p-3">
              <div className="flex items-center gap-2 font-medium"><Icon size={15} className="flex-none text-ink-soft" aria-hidden /> <span className="min-w-0 break-anywhere">{t(title)}</span></div>
              <p className="text-ink-soft">{t(text)}</p>
              {go && onGo && (!go.owner || owner) && <button type="button" className="pick mt-auto self-start text-xs underline underline-offset-2 hover:text-ink" onClick={() => onGo(go.section)}>{t(go.label)}</button>}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-serif text-base font-medium">{t('Did you know')}</h3>
        <ul className="flex flex-col gap-2">
          {TIPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-2.5"><Icon size={15} className="mt-0.5 flex-none text-accent" aria-hidden /> <span className="min-w-0 break-anywhere">{t(text)}</span></li>
          ))}
        </ul>
      </section>
    </div>
  )
}
