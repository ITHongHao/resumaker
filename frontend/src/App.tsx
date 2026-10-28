import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { cn } from '@/lib/utils'
import JobPage from '@/pages/JobPage'
import Profile from '@/pages/Profile'
import Record from '@/pages/Record'
import Resumes from '@/pages/Resumes'
import Settings from '@/pages/Settings'

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
    isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
  )

function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-3xl items-center gap-1 px-6 py-3">
          <span className="mr-4 font-semibold">Resumaker</span>
          <NavLink to="/resumes" className={link}>Resumes</NavLink>
          <NavLink to="/record" className={link}>Record</NavLink>
          <NavLink to="/profile" className={link}>Profile</NavLink>
          <NavLink to="/settings" className={cn(link, 'ml-auto')}>Settings</NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/record" replace />} />
          <Route path="/resumes" element={<Resumes />} />
          <Route path="/record" element={<Record />} />
          <Route path="/record/jobs/:id" element={<JobPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
