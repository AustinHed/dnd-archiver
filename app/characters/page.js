'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const COMMON_RACES = [
  'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Tiefling',
  'Aasimar', 'Firbolg', 'Genasi', 'Goliath', 'Kenku', 'Lizardfolk', 'Tabaxi', 'Triton', 'Tortle',
  'Changeling', 'Kalashtar', 'Warforged', 'Shifter',
]

const COMMON_CLASSES = [
  'Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter',
  'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
]

const COMMON_BACKGROUNDS = [
  'Acolyte', 'Charlatan', 'Criminal', 'Entertainer', 'Folk Hero', 'Guild Artisan',
  'Hermit', 'Noble', 'Outlander', 'Sage', 'Sailor', 'Soldier', 'Urchin',
  'Far Traveler', 'Haunted One', 'Investigator', 'Mercenary Veteran', 'Pirate',
]

const emptyForm = { name: '', player: '', race: '', class: '', level: 1, background: '', description: '' }

export default function CharactersPage() {
  const [characters, setCharacters] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/characters')
      .then(r => r.json())
      .then(data => setCharacters(Array.isArray(data) ? data : []))
      .catch(() => setCharacters([]))
  }, [])

  function setField(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create character.')
      } else {
        setCharacters(prev => [...(prev || []), data].sort((a, b) => a.name.localeCompare(b.name)))
        setForm(emptyForm)
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
          <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Party Characters</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
            Character sheets are sent to the AI with each transcript for richer, more accurate reports
          </p>
        </div>
        <button onClick={() => { setShowForm(v => !v); setError('') }} style={primaryBtnStyle}>
          {showForm ? '✕ Cancel' : '+ Add Character'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={formCardStyle}>
          <div style={{ fontWeight: 600, color: '#c8a96e', marginBottom: '0.75rem', fontSize: '1rem' }}>
            New Character
          </div>
          <div style={gridStyle}>
            <Field label="Character Name *">
              <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Thorin Ironhammer" required style={inputStyle} />
            </Field>
            <Field label="Player Name">
              <input value={form.player} onChange={e => setField('player', e.target.value)} placeholder="e.g. Austin" style={inputStyle} />
            </Field>
            <Field label="Race">
              <input value={form.race} onChange={e => setField('race', e.target.value)} placeholder="e.g. Dwarf" list="races" style={inputStyle} />
              <datalist id="races">{COMMON_RACES.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Class">
              <input value={form.class} onChange={e => setField('class', e.target.value)} placeholder="e.g. Fighter" list="classes" style={inputStyle} />
              <datalist id="classes">{COMMON_CLASSES.map(c => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Level">
              <input type="number" min={1} max={20} value={form.level} onChange={e => setField('level', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Background">
              <input value={form.background} onChange={e => setField('background', e.target.value)} placeholder="e.g. Soldier" list="backgrounds" style={inputStyle} />
              <datalist id="backgrounds">{COMMON_BACKGROUNDS.map(b => <option key={b} value={b} />)}</datalist>
            </Field>
          </div>
          <Field label="Description / Backstory">
            <textarea
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              placeholder="Personality traits, backstory, goals, physical description — anything useful for the AI…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          {error && <div style={{ color: '#e07070', fontSize: '0.85rem', marginTop: '0.25rem' }}>{error}</div>}
          <div style={{ marginTop: '0.75rem' }}>
            <button type="submit" disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving…' : 'Create Character'}
            </button>
          </div>
        </form>
      )}

      {characters === null ? (
        <div style={{ color: '#555', fontSize: '0.9rem' }}>Loading…</div>
      ) : characters.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem 2rem',
          color: '#555',
          border: '1px dashed #2a2a2a',
          borderRadius: '10px',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🧙</div>
          <p style={{ margin: '0 0 0.5rem' }}>No characters yet.</p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            Add your party members above. Their details will be included with every transcript you upload.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {characters.map(c => (
            <Link key={c.slug} href={`/characters/${c.slug}`} style={{ textDecoration: 'none' }}>
              <div
                style={characterCardStyle}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#c8a96e'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a2a'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#e8e8e8', marginBottom: '0.2rem' }}>
                      {c.name}
                      {c.level ? <span style={{ fontWeight: 400, fontSize: '0.85rem', color: '#888', marginLeft: '0.6rem' }}>Lvl {c.level}</span> : null}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#888' }}>
                      {[c.race, c.class].filter(Boolean).join(' ')}
                      {c.background ? ` · ${c.background}` : ''}
                      {c.player ? <span style={{ color: '#555' }}> · Played by {c.player}</span> : null}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#555', whiteSpace: 'nowrap' }}>Edit →</span>
                </div>
                {c.description && (
                  <div style={{
                    marginTop: '0.5rem',
                    fontSize: '0.83rem',
                    color: '#777',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {c.description}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.78rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  )
}

const formCardStyle = {
  background: '#161616',
  border: '1px solid #2a2a2a',
  borderRadius: '10px',
  padding: '1.25rem',
  marginBottom: '1.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.65rem',
}

const characterCardStyle = {
  background: '#161616',
  border: '1px solid #2a2a2a',
  borderRadius: '10px',
  padding: '1rem 1.25rem',
  cursor: 'pointer',
  transition: 'border-color 0.15s',
}

const inputStyle = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '0.45rem 0.7rem',
  color: '#e8e8e8',
  fontSize: '0.875rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
}

const primaryBtnStyle = {
  background: '#1e1a10',
  color: '#c8a96e',
  border: '1px solid #c8a96e',
  borderRadius: '6px',
  padding: '0.45rem 0.9rem',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}
