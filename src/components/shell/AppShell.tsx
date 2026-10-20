import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar'
import { ImportDialog } from './ImportDialog'
import { RemoteTraceLoader } from './RemoteTraceLoader'

export function AppShell() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      <RemoteTraceLoader />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
      <ImportDialog />
    </div>
  )
}
