export const metadata = {
  title: 'D&D Session Archiver',
  description: 'Transform session transcripts into structured reports',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '820px',
        margin: '0 auto',
        padding: '2rem 1.5rem',
        background: '#0f0f0f',
        color: '#e8e8e8',
        minHeight: '100vh',
      }}>
        <header style={{ marginBottom: '2.5rem', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>
          <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#c8a96e' }}>⚔️ D&D Session Archiver</h1>
          </a>
        </header>
        {children}
      </body>
    </html>
  )
}
