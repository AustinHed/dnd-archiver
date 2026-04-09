import { Redis } from '@upstash/redis'
import { notFound } from 'next/navigation'
import CopyButton from './CopyButton'

function getKv() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
}

export default async function ResultPage({ params }) {
  const { id } = await params
  const result = await getKv().get(`result:${id}`)

  if (!result) notFound()

  const date = new Date(result.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  // Split into sections for nicer rendering
  const sections = parseReport(result.text)

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Session Report</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
            {result.fileName} &middot; {date}
          </p>
        </div>
        <CopyButton />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
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
            <div style={{ lineHeight: 1.7, fontSize: '0.95rem', whiteSpace: 'pre-wrap', color: '#d8d8d8' }}>
              {body}
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
      current.body += line + '\n'
    }
  }
  if (current.body.trim()) sections.push({ ...current, body: current.body.trim() })

  return sections
}
