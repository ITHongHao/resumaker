import { Link, useParams } from 'react-router-dom'

export default function ApplicationPlaceholder() {
  const { id } = useParams()
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Application {id}</h1>
      <p className="text-muted-foreground">The editor for this resume is coming soon.</p>
      <Link to="/resumes" className="text-sm text-primary underline">Back to Resumes</Link>
    </div>
  )
}
