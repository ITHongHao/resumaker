import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import JobPage from '@/pages/JobPage'
import Interview from '@/pages/Interview'
import Profile from '@/pages/Profile'
import Record from '@/pages/Record'
import Editor from '@/pages/Editor'
import Gallery from '@/pages/Gallery'
import NewApplication from '@/pages/NewApplication'
import Settings from '@/pages/Settings'

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
    isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
  )

function App() {
  const path = useLocation().pathname
  const width = path.startsWith('/applications/') ? 'max-w-7xl' : path === '/resumes' || path === '/interview' ? 'max-w-5xl' : 'max-w-3xl'
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <nav className={cn('mx-auto flex items-center gap-1 px-6 py-3', width)}>
          <span className="mr-4 font-semibold">Resumaker</span>
          <NavLink to="/resumes" className={link}>Resumes</NavLink>
          <NavLink to="/record" className={link}>Record</NavLink>
          <NavLink to="/interview" className={link}>Interview</NavLink>
          <NavLink to="/profile" className={link}>Profile</NavLink>
          <NavLink to="/settings" className={cn(link, 'ml-auto')}>Settings</NavLink>
        </nav>
      </header>
      <main className={cn('mx-auto px-4 py-8 sm:px-6', width)}>
        <Routes>
          <Route path="/" element={<Navigate to="/record" replace />} />
          <Route path="/resumes" element={<Gallery />} />
          <Route path="/resumes/new" element={<NewApplication />} />
          <Route path="/applications/:id" element={<Editor />} />
          <Route path="/record" element={<Record />} />
          <Route path="/record/jobs/:id" element={<JobPage />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
