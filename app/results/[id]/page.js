import { notFound } from 'next/navigation'
import { getKv } from '@/lib/redis'
import CopyButton from './CopyButton'
import DeleteButton from './DeleteButton'

export default async function ResultPage({ params }) {
  const { id } = await params
  const result = await getKv().get(`result:${id}`)

  if (!result) notFound()

  const date = new Date(result.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const sections = parseReport(result.text)

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>
            {result.title || 'Session Report'}
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
            {result.fileName} &middot; {date}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <CopyButton />
          <DeleteButton id={id} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
        {Array.isArray(result.mapIds) && result.mapIds.length > 0 && (
          <section>
            <h3 style={{
              margin: '0 0 0.6rem',
              fontSize: '1rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#c8a96e',
              borderBottom: '1px solid #2a2a2a',
              paddingBottom: '0.4rem',
            }}>
              Linked Maps
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {result.mapIds.map((mapId) => (
                <a
                  key={mapId}
                  href={`/vtt?map=${mapId}`}
                  style={{
                    fontSize: '0.8rem',
                    color: '#c8a96e',
                    border: '1px solid #3a3222',
                    borderRadius: '999px',
                    padding: '0.2rem 0.6rem',
                    textDecoration: 'none',
                  }}
                >
                  Open Map
                </a>
              ))}
            </div>
          </section>
        )}

        {sections.map(({ heading, body }, i) => (
          <section key={i}>
            {heading && (
              <h3 style={{
                margin: '0 0 0.6rem',
                fontSize: '1rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#c8a96e',
                borderBottom: '1px solid #2a2a2a',
                paddingBottom: '0.4rem',
              }}>
                {heading}
              </h3>
            )}
            <div style={{ lineHeight: 1.75, fontSize: '0.95rem', color: '#d8d8d8' }}>
              {renderBody(body)}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

function parseReport(text) {
  const lines = text.split('\n')
  const sections = []
  let current = { heading: '', body: '' }

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (current.body.trim()) sections.push({ ...current, body: current.body.trim() })
      current = { heading: line.replace(/^#+\s*/, ''), body: '' }
    } else {
      current.body += `${line}\n`
    }
  }
  if (current.body.trim()) sections.push({ ...current, body: current.body.trim() })

  return sections
}

function renderBody(text) {
  const lines = text.split('\n')
  const output = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      output.push(<div key={i} style={{ height: '0.4em' }} />)
      i += 1
      continue
    }

    if (/^#{2,}\s/.test(line)) {
      output.push(
        <div key={i} style={{ fontWeight: 700, color: '#c8a96e', marginTop: '0.5rem', marginBottom: '0.15rem' }}>
          {renderInline(line.replace(/^#+\s*/, ''))}
        </div>,
      )
      i += 1
      continue
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)/)
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2)
      output.push(
        <div key={i} style={{
          paddingLeft: `${1 + indent * 1.25}rem`,
          display: 'flex',
          gap: '0.4rem',
        }}>
          <span style={{ color: '#c8a96e', flexShrink: 0 }}>•</span>
          <span>{renderInline(bulletMatch[2])}</span>
        </div>,
      )
      i += 1
      continue
    }

    output.push(<div key={i}>{renderInline(line)}</div>)
    i += 1
  }

  return output
}

function renderInline(text) {
  const parts = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let key = 0
  let m

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      parts.push(<strong key={key++}>{m[1]}</strong>)
    } else {
      parts.push(<em key={key++}>{m[2]}</em>)
    }
    last = re.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))

  return parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts
}
