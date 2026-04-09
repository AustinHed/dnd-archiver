'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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

export default function CharacterDetailPage({ params }) {
  const { name } = use(params)
  const router = useRouter()

  const [character, setCharacter] = useState(null)
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    fetch(`/api/characters/${name}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setCharacter(data); setForm({ ...data }) })
      .catch(() => router.push('/characters'))
  }, [name, router])

  function setField(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/characters/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setCharacter(updated)
      setForm({ ...updated })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setForm({ ...character })
    setDirty(false)
  }

  async function handleDelete() {
    await fetch(`/api/characters/${name}`, { method: 'DELETE' })
    router.push('/characters')
  }

  if (!form) return <main><div style={{ color: '#555' }}>Loading…</div></main>

  const subtitle = [form.race, form.class].filter(Boolean).join(' ') +
    (form.level ? ` · Level ${form.level}` : '') +
    (form.player ? ` · Played by ${form.player}` : '')

  return (
    <main>
      <Link href="/characters" style={{ color: '#c8a96e', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.25rem' }}>
        ← Characters
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem' }}>{character.name}</h2>
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <span style={{ color: '#aaa' }}>Delete this character?</span>
            <button onClick={handleDelete} style={dangerBtnStyle}>Yes, delete</button>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={ghostBtnStyle}>Delete</button>
        )}
      </div>
      {subtitle && <p style={{ margin: '0 0 1.75rem', fontSize: '0.85rem', color: '#666' }}>{subtitle}</p>}

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

        <section style={sectionStyle}>
          <div style={sectionHeadingStyle}>Identity</div>
          <div style={gridStyle}>
            <Field label="Character Name">
              <input value={form.name} disabled style={{ ...inputStyle, opacity: 0.5 }} />
              <div style={{ fontSize: '0.72rem', color: '#555', marginTop: '0.2rem' }}>Name cannot be changed after creation</div>
            </Field>
            <Field label="Player Name">
              <input value={form.player} onChange={e => setField('player', e.target.value)} placeholder="e.g. Austin" style={inputStyle} />
            </Field>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionHeadingStyle}>Character Sheet</div>
          <div style={gridStyle}>
            <Field label="Race">
              <input value={form.race} onChange={e => setField('race', e.target.value)} placeholder="e.g. Dwarf" list="races-edit" style={inputStyle} />
              <datalist id="races-edit">{COMMON_RACES.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Class">
              <input value={form.class} onChange={e => setField('class', e.target.value)} placeholder="e.g. Fighter" list="classes-edit" style={inputStyle} />
              <datalist id="classes-edit">{COMMON_CLASSES.map(c => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Level">
              <input type="number" min={1} max={20} value={form.level} onChange={e => setField('level', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Background">
              <input value={form.background} onChange={e => setField('background', e.target.value)} placeholder="e.g. Soldier" list="backgrounds-edit" style={inputStyle} />
              <datalist id="backgrounds-edit">{COMMON_BACKGROUNDS.map(b => <option key={b} value={b} />)}</datalist>
            </Field>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionHeadingStyle}>Description & Backstory</div>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.8rem', color: '#555', lineHeight: 1.5 }}>
            This text is included verbatim in every AI report prompt. Describe personality, appearance, goals, relationships, secrets — anything that helps the AI write more accurate session summaries.
          </p>
          <textarea
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="Personality traits, backstory, goals, physical description, notable relationships, ongoing story threads…"
            rows={6}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
          />
        </section>

        {dirty && (
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button type="submit" disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
              Discard
            </button>
          </div>
        )}

        {!dirty && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#444' }}>
            Last updated: {new Date(form.updatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </form>
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

const sectionStyle = {
  background: '#111',
  border: '1px solid #222',
  borderRadius: '10px',
  padding: '1.1rem 1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
}

const sectionHeadingStyle = {
  fontSize: '0.78rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  color: '#c8a96e',
  marginBottom: '0.1rem',
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.65rem',
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
}

const ghostBtnStyle = {
  background: 'none',
  color: '#777',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '0.35rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
}

const dangerBtnStyle = {
  background: '#2a1111',
  color: '#e07070',
  border: '1px solid #5a2020',
  borderRadius: '6px',
  padding: '0.35rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
}
