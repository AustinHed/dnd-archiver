'use client'

import { useState } from 'react'

export default function CopyButton() {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      style={{
        background: copied ? '#1a2a1a' : '#1e1e1e',
        color: copied ? '#6ec87a' : '#999',
        border: `1px solid ${copied ? '#3a6a3a' : '#333'}`,
        borderRadius: '6px',
        padding: '0.5rem 1rem',
        cursor: 'pointer',
        fontSize: '0.85rem',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      {copied ? '✓ Copied!' : 'Copy link'}
    </button>
  )
}
