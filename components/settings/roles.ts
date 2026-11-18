import type { Role } from '@/lib/types'

export const ROLES: Role[] = ['editor', 'reader', 'owner']

export const INVITE_ROLES: Role[] = ['editor', 'reader']

export const roleName: Record<Role, string> = { owner: 'owner', editor: 'editor', reader: 'reader' }

export const roleHelp: Record<Role, string> = {
  owner: 'Owner: everything, including settings and other people’s access.',
  editor: 'Editor: sees everyone and can change the chart and pages.',
  reader: 'Reader: views the chart, with living relatives hidden.',
}
