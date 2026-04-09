import Sidebar from './components/Sidebar'

export const metadata = {
  title: 'D&D Session Archiver',
  description: 'Transform session transcripts into structured reports',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#0f0f0f',
        color: '#e8e8e8',
        minHeight: '100vh',
        margin: 0,
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1.5rem' }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2rem',
            padding: '1.25rem 0',
            marginBottom: '1.5rem',
            borderBottom: '1px solid #2a2a2a',
          }}>
            <a href="/" style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
              <h1 style={{ margin: 0, fontSize: '1.35rem', color: '#c8a96e' }}>⚔️ D&D Session Archiver</h1>
            </a>
            <nav style={{ display: 'flex', gap: '0.25rem' }}>
              <a href="/" style={navLinkStyle}>
                📜 Upload
              </a>
              <a href="/npcs" style={navLinkStyle}>
                👥 NPCs
              </a>
            </nav>
          </header>

          <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'flex-start' }}>
            <Sidebar />
            <div style={{ flex: 1, minWidth: 0 }}>
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}

const navLinkStyle = {
  color: '#aaa',
  textDecoration: 'none',
  fontSize: '0.875rem',
  padding: '0.3rem 0.65rem',
  borderRadius: '6px',
  transition: 'color 0.1s, background 0.1s',
}
