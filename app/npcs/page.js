'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function NpcsPage() {
  const [npcs, setNpcs] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/npcs')
      .then(r => r.json())
      .then(data => setNpcs(Array.isArray(data) ? data : []))
      .catch(() => setNpcs([]))
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/npcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create NPC.')
      } else {
        setNpcs(prev => [...(prev || []), data].sort((a, b) => a.name.localeCompare(b.name)))
        setName('')
        setDescription('')
        setShowForm(false)
      }
    } catch {
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Non-Player Characters</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
            Allies, enemies, and contacts encountered across your campaign
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={btnStyle('#c8a96e', '#1a1710')}
        >
          {showForm ? '✕ Cancel' : '+ Add NPC'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#161616',
          border: '1px solid #2a2a2a',
          borderRadius: '10px',
          padding: '1.25rem',
          marginBottom: '1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}>
          <div style={{ fontWeight: 600, color: '#c8a96e', marginBottom: '0.25rem' }}>New NPC</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name (e.g. Gundren Rockseeker)"
            required
            style={inputStyle}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description (optional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          {error && <div style={{ color: '#e07070', fontSize: '0.85rem' }}>{error}</div>}
          <button type="submit" disabled={saving} style={btnStyle('#c8a96e', '#1a1710')}>
            {saving ? 'Saving…' : 'Create NPC'}
          </button>
        </form>
      )}

      {npcs === null ? (
        <div style={{ color: '#555', fontSize: '0.9rem' }}>Loading…</div>
      ) : npcs.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem 2rem',
          color: '#555',
          border: '1px dashed #2a2a2a',
          borderRadius: '10px',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>👥</div>
          <p style={{ margin: '0 0 0.5rem' }}>No NPCs yet.</p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            NPCs are auto-extracted when you upload a transcript, or you can add them manually.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
          {npcs.map(npc => (
            <Link key={npc.slug} href={`/npcs/${npc.slug}`} style={{ textDecoration: 'none' }}>
              <div style={{
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: '10px',
                padding: '1rem 1.1rem',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#c8a96e'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a2a'}
              >
                <div style={{ fontWeight: 600, color: '#e8e8e8', marginBottom: '0.3rem' }}>
                  {npc.name}
                </div>
                {npc.description && (
                  <div style={{
                    fontSize: '0.82rem',
                    color: '#888',
                    lineHeight: 1.45,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    marginBottom: '0.5rem',
                  }}>
                    {npc.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: '#555' }}>
                  <span>{npc.sessionIds?.length || 0} session{npc.sessionIds?.length !== 1 ? 's' : ''}</span>
                  {npc.notes?.length > 0 && <span>{npc.notes.length} note{npc.notes.length !== 1 ? 's' : ''}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

const inputStyle = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '0.5rem 0.75rem',
  color: '#e8e8e8',
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
}

function btnStyle(color, bg) {
  return {
    background: bg,
    color: color,
    border: `1px solid ${color}`,
    borderRadius: '6px',
    padding: '0.45rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
}
