'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [status, setStatus] = useState('idle') // idle | uploading | error
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)
  const router = useRouter()

  async function handleFile(file) {
    if (!file) return
    const allowed = ['.txt', '.md', '.docx']
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!allowed.includes(ext)) {
      setErrorMsg('Only .txt, .md, and .docx files are supported.')
      setStatus('error')
      return
    }

    setStatus('uploading')
    setErrorMsg('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || 'Something went wrong.')
        setStatus('error')
        return
      }
      router.push(`/results/${data.id}`)
    } catch {
      setErrorMsg('Network error — please try again.')
      setStatus('error')
    }
  }

  function onInputChange(e) {
    handleFile(e.target.files?.[0])
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const uploading = status === 'uploading'

  return (
    <main>
      <p style={{ color: '#999', marginTop: 0, marginBottom: '2rem' }}>
        Upload a session transcript and get a structured report — summary, combat, NPCs, loot, and more.
      </p>

      <div
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? '#c8a96e' : '#444'}`,
          borderRadius: '10px',
          padding: '3rem 2rem',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: dragging ? '#1a1710' : '#161616',
          transition: 'border-color 0.15s, background 0.15s',
          userSelect: 'none',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.docx"
          style={{ display: 'none' }}
          onChange={onInputChange}
          disabled={uploading}
        />

        {uploading ? (
          <>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⏳</div>
            <p style={{ margin: 0, color: '#c8a96e' }}>Processing transcript…</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#666' }}>
              This may take 15–30 seconds
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📜</div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
              Drop your transcript here, or click to browse
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
              Supports .txt, .md, .docx
            </p>
          </>
        )}
      </div>

      {status === 'error' && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          background: '#2a1111',
          border: '1px solid #5a2020',
          borderRadius: '6px',
          color: '#e07070',
          fontSize: '0.9rem',
        }}>
          {errorMsg}
        </div>
      )}
    </main>
  )
}
