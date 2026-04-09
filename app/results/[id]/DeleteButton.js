'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteButton({ id }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    await fetch(`/api/results/${id}`, { method: 'DELETE' })
    router.push('/')
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem', color: '#aaa' }}>Delete this session?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={dangerBtnStyle}
        >
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button onClick={() => setConfirming(false)} style={ghostBtnStyle}>Cancel</button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirming(true)} style={ghostBtnStyle}>
      Delete session
    </button>
  )
}

const ghostBtnStyle = {
  background: 'none',
  color: '#666',
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
