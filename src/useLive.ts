import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

export function useLive<T>(q: () => Promise<T>, _deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(q).subscribe({ next: setV, error: () => {} })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return v
}
