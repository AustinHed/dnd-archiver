'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NpcDetailPage({ params }) {
  const { name } = use(params)
  const router = useRouter()

  const [npc, setNpc] = useState(null)
  const [sessions, setSessions] = useState({}) // id -> { fileName, title, createdAt }
  const [editingDesc, setEditingDesc] = useState(false)
  const [desc, setDesc] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteAuthor, setNoteAuthor] = useState('')
  const [addingSession, setAddingSession] = useState(false)
  const [allSessions, setAllSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    fetch(`/api/npcs/${name}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => {
        setNpc(data)
        setDesc(data.description || '')
      })
      .catch(() => router.push('/npcs'))
  }, [name, router])

  // Load session metadata for linked sessions
  useEffect(() => {
    if (!npc?.sessionIds?.length) return
    fetch('/api/results')
      .then(r => r.json())
      .then(data => {
        const map = {}
        for (const s of data) map[s.id] = s
        setSessions(map)
      })
      .catch(() => {})
  }, [npc?.sessionIds?.join(',')])

  async function patch(body) {
    const res = await fetch(`/api/npcs/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error()
    return res.json()
  }

  async function saveDescription() {
    setSaving(true)
    try {
      const updated = await patch({ description: desc })
      setNpc(updated)
      setEditingDesc(false)
    } finally {
      setSaving(false)
    }
  }

  async function addNote(e) {
    e.preventDefault()
    if (!noteText.trim()) return
    setSaving(true)
    try {
      const updated = await patch({ note: { text: noteText.trim(), author: noteAuthor.trim() } })
      setNpc(updated)
      setNoteText('')
      setNoteAuthor('')
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(index) {
    setSaving(true)
    try {
      const updated = await patch({ deleteNoteIndex: index })
      setNpc(updated)
    } finally {
      setSaving(false)
    }
  }

  async function linkSession(e) {
    e.preventDefault()
    if (!selectedSession) return
    setSaving(true)
    try {
      const updated = await patch({ sessionId: selectedSession })
      setNpc(updated)
      setSelectedSession('')
      setAddingSession(false)
    } finally {
      setSaving(false)
    }
  }

  async function unlinkSession(sessionId) {
    setSaving(true)
    try {
      const updated = await patch({ removeSessionId: sessionId })
      setNpc(updated)
    } finally {
      setSaving(false)
    }
  }

  async function openAddSession() {
    setAddingSession(true)
    fetch('/api/results')
      .then(r => r.json())
      .then(data => setAllSessions(Array.isArray(data) ? data : []))
      .catch(() => {})
  }

  async function deleteNpc() {
    await fetch(`/api/npcs/${name}`, { method: 'DELETE' })
    router.push('/npcs')
  }

  if (!npc) {
    return <main><div style={{ color: '#555' }}>Loading…</div></main>
  }

  return (
    <main>
      {/* Back link */}
      <Link href="/npcs" style={{ color: '#c8a96e', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.25rem' }}>
        ← NPCs
      </Link>

      {/* NPC Name + Delete */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem' }}>{npc.name}</h2>
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <span style={{ color: '#aaa' }}>Delete this NPC?</span>
            <button onClick={deleteNpc} style={dangerBtnStyle}>Yes, delete</button>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={ghostBtnStyle}>Delete NPC</button>
        )}
      </div>

      {/* Description */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <h3 style={sectionHeadingStyle}>Description</h3>
          {!editingDesc && (
            <button onClick={() => setEditingDesc(true)} style={ghostBtnStyle}>Edit</button>
          )}
        </div>
        {editingDesc ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              placeholder="Describe this NPC…"
              style={{ ...inputStyle, resize: 'vertical' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={saveDescription} disabled={saving} style={primaryBtnStyle}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditingDesc(false); setDesc(npc.description) }} style={ghostBtnStyle}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: npc.description ? '#d8d8d8' : '#555', fontSize: '0.95rem', lineHeight: 1.65 }}>
            {npc.description || 'No description yet. Click Edit to add one.'}
          </p>
        )}
      </section>

      {/* Sessions */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <h3 style={sectionHeadingStyle}>Sessions</h3>
          {!addingSession && (
            <button onClick={openAddSession} style={ghostBtnStyle}>+ Link session</button>
          )}
        </div>

        {addingSession && (
          <form onSubmit={linkSession} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={selectedSession}
              onChange={e => setSelectedSession(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: '150px' }}
            >
              <option value="">Select a session…</option>
              {allSessions
                .filter(s => !npc.sessionIds.includes(s.id))
                .map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.fileName} — {new Date(s.createdAt).toLocaleDateString()}
                  </option>
                ))}
            </select>
            <button type="submit" disabled={!selectedSession || saving} style={primaryBtnStyle}>Link</button>
            <button type="button" onClick={() => setAddingSession(false)} style={ghostBtnStyle}>Cancel</button>
          </form>
        )}

        {npc.sessionIds?.length === 0 ? (
          <p style={{ margin: 0, color: '#555', fontSize: '0.9rem' }}>
            No sessions linked yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {npc.sessionIds.map(sid => {
              const s = sessions[sid]
              const label = s ? (s.title || s.fileName) : sid.slice(0, 8) + '…'
              const date = s ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
              return (
                <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'space-between' }}>
                  <Link href={`/results/${sid}`} style={{ color: '#c8a96e', fontSize: '0.9rem', textDecoration: 'none' }}>
                    📜 {label}{date ? ` — ${date}` : ''}
                  </Link>
                  <button
                    onClick={() => unlinkSession(sid)}
                    title="Unlink"
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.8rem', padding: '0.1rem 0.3rem' }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Notes */}
      <section style={sectionStyle}>
        <h3 style={{ ...sectionHeadingStyle, marginBottom: '0.75rem' }}>Notes</h3>

        {npc.notes?.length === 0 && (
          <p style={{ margin: '0 0 1rem', color: '#555', fontSize: '0.9rem' }}>No notes yet.</p>
        )}

        {npc.notes?.map((note, i) => (
          <div key={i} style={{
            background: '#161616',
            border: '1px solid #2a2a2a',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '0.6rem',
          }}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', lineHeight: 1.6, color: '#d8d8d8' }}>
              {note.text}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#555' }}>
                {note.author ? `${note.author} · ` : ''}
                {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <button
                onClick={() => deleteNote(i)}
                disabled={saving}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.75rem', padding: '0.1rem 0.3rem' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {/* Add note form */}
        <form onSubmit={addNote} style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Add a note about this NPC…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              value={noteAuthor}
              onChange={e => setNoteAuthor(e.target.value)}
              placeholder="Your name (optional)"
              style={{ ...inputStyle, flex: '1', minWidth: '120px' }}
            />
            <button type="submit" disabled={!noteText.trim() || saving} style={primaryBtnStyle}>
              {saving ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

const sectionStyle = {
  background: '#111',
  border: '1px solid #222',
  borderRadius: '10px',
  padding: '1.1rem 1.25rem',
  marginBottom: '1.25rem',
}

const sectionHeadingStyle = {
  margin: 0,
  fontSize: '0.85rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#c8a96e',
}

const inputStyle = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '0.5rem 0.75rem',
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

const ghostBtnStyle = {
  background: 'none',
  color: '#777',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '0.35rem 0.75rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
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
