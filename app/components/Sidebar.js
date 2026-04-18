'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function Sidebar() {
  const [results, setResults] = useState(null) // null = loading
  const pathname = usePathname()

  if (pathname === '/vtt') {
    return null
  }

  useEffect(() => {
    fetch('/api/results')
      .then(r => r.json())
      .then(data => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
  }, [pathname])

  return (
    <aside style={{
      width: '210px',
      flexShrink: 0,
      paddingRight: '1rem',
      borderRight: '1px solid #222',
      minHeight: '200px',
    }}>
      <div style={{
        fontSize: '0.7rem',
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: '0.75rem',
        fontWeight: 600,
      }}>
        Game Log
      </div>

      {results === null ? (
        <div style={{ fontSize: '0.8rem', color: '#444' }}>Loading…</div>
      ) : results.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: '#444', lineHeight: 1.5 }}>
          No sessions yet.<br />
          <Link href="/" style={{ color: '#c8a96e', fontSize: '0.8rem' }}>Upload one →</Link>
        </div>
      ) : (
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {results.map(r => {
            const isActive = pathname === `/results/${r.id}`
            const label = r.title || r.fileName?.replace(/\.[^.]+$/, '') || 'Session'
            const date = new Date(r.createdAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric',
            })
            return (
              <Link
                key={r.id}
                href={`/results/${r.id}`}
                style={{
                  display: 'block',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: isActive ? '#c8a96e' : '#999',
                  background: isActive ? '#1e1a10' : 'transparent',
                  fontSize: '0.82rem',
                  lineHeight: 1.35,
                  transition: 'background 0.1s, color 0.1s',
                  borderLeft: isActive ? '2px solid #c8a96e' : '2px solid transparent',
                }}
              >
                <div style={{
                  fontWeight: isActive ? 600 : 400,
                  wordBreak: 'break-word',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {label}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '0.15rem' }}>
                  {date}
                </div>
              </Link>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
