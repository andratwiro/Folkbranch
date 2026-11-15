import { expect, it, vi } from 'vitest'
import { isLiveConnected, setLiveConnected, subscribeLive } from '@/lib/use-live'

// The hooks need a browser; this store is what ConnectionNotice's polling depends on.
it('tells subscribers only when the connection state really changes', () => {
  const seen = vi.fn()
  const off = subscribeLive(seen)
  expect(isLiveConnected()).toBe(false)
  setLiveConnected(false)
  expect(seen).not.toHaveBeenCalled()
  setLiveConnected(true)
  setLiveConnected(true)
  expect(isLiveConnected()).toBe(true)
  setLiveConnected(false)
  expect(seen).toHaveBeenCalledTimes(2)
  off()
  setLiveConnected(true)
  expect(seen).toHaveBeenCalledTimes(2)
  setLiveConnected(false)
})
