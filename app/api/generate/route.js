import { Redis } from '@upstash/redis'
import { v4 as uuidv4 } from 'uuid'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Extract NPC names from the generated report's NPC section. */
function extractNpcNames(text) {
  const lines = text.split('\n')
  const names = []
  let inNpcSection = false

  for (const line of lines) {
    if (line.startsWith('# ')) {
      const heading = line.slice(2).toLowerCase()
      inNpcSection =
        heading.includes('npc') ||
        heading.includes('non-player') ||
        heading.includes('notable character')
    } else if (inNpcSection) {
      // Match bullet entries like: - **Name** or * **Name**
      const m = line.match(/^[-*]\s+\*\*([^*]+)\*\*/)
      if (m) names.push(m[1].trim())
    }
  }

  return [...new Set(names)]
}

/** Extract a display title from the first heading in the report. */
function extractTitle(text, fallback) {
  const firstHeading = text.split('\n').find(l => l.startsWith('# '))
  return firstHeading ? firstHeading.replace(/^#+\s*/, '').trim() : fallback
}

/** Build a character context block to prepend to the transcript. */
function buildCharacterContext(characters) {
  if (!characters.length) return ''
  const lines = ['=== PARTY CHARACTERS ===']
  for (const c of characters) {
    const parts = [c.name]
    const sheet = [c.race, c.class].filter(Boolean).join(' ')
    if (sheet) parts.push(sheet)
    if (c.level) parts.push(`Level ${c.level}`)
    if (c.background) parts.push(`Background: ${c.background}`)
    if (c.player) parts.push(`Player: ${c.player}`)
    lines.push(parts.join(', '))
    if (c.description) lines.push(`  ${c.description}`)
  }
  lines.push('=== END PARTY INFO ===', '')
  return lines.join('\n') + '\n'
}

const PROMPT_ID = 'pmpt_69d7215083bc8195a80e445d0e1ba9d9022120c48a15cb71'

export async function POST(request) {
  const formData = await request.formData()
  const file = formData.get('file')

  if (!file) {
    return Response.json({ error: 'No file provided.' }, { status: 400 })
  }

  const fileName = file.name
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()

  // Parse transcript text from file
  let transcript
  try {
    if (ext === '.docx') {
      const mammoth = (await import('mammoth')).default
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await mammoth.extractRawText({ buffer })
      transcript = result.value
    } else {
      transcript = await file.text()
    }
  } catch (err) {
    return Response.json({ error: `Failed to read file: ${err.message}` }, { status: 400 })
  }

  if (!transcript?.trim()) {
    return Response.json({ error: 'File appears to be empty.' }, { status: 400 })
  }

  // Fetch party characters to give the AI context (best-effort)
  const kv = getKv()
  let characterContext = ''
  try {
    const slugs = await kv.smembers('characters:index')
    if (slugs.length) {
      const chars = (await Promise.all(slugs.map(s => kv.get(`character:${s}`)))).filter(Boolean)
      characterContext = buildCharacterContext(chars)
    }
  } catch (err) {
    console.error('Character fetch error (non-fatal):', err)
  }

  const fullTranscript = characterContext ? `${characterContext}${transcript}` : transcript

  // Call OpenAI Responses API with stored prompt template
  let generatedText
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: {
          id: PROMPT_ID,
          variables: { transcript: fullTranscript },
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('OpenAI error:', body)
      return Response.json({ error: `OpenAI API error (${res.status}). Check server logs.` }, { status: 502 })
    }

    const data = await res.json()
    generatedText = data.output_text
      ?? data.output?.[0]?.content?.[0]?.text
      ?? JSON.stringify(data)
  } catch (err) {
    return Response.json({ error: `Failed to call OpenAI: ${err.message}` }, { status: 502 })
  }

  // Store result in Redis
  const id = uuidv4()
  const title = extractTitle(generatedText, fileName.replace(/\.[^.]+$/, ''))

  await kv.set(`result:${id}`, {
    id,
    text: generatedText,
    fileName,
    title,
    createdAt: new Date().toISOString(),
  })

  // Auto-extract and link NPCs from the report (best-effort, non-blocking)
  try {
    const npcNames = extractNpcNames(generatedText)
    await Promise.all(
      npcNames.map(async name => {
        const slug = slugify(name)
        if (!slug) return
        const existing = await kv.get(`npc:${slug}`)
        if (existing) {
          // Link this session to the existing NPC
          existing.sessionIds = [...new Set([...existing.sessionIds, id])]
          await kv.set(`npc:${slug}`, existing)
        } else {
          // Create a new NPC entry
          const npc = {
            name,
            slug,
            description: '',
            sessionIds: [id],
            notes: [],
            createdAt: new Date().toISOString(),
          }
          await kv.set(`npc:${slug}`, npc)
          await kv.sadd('npcs:index', slug)
        }
      })
    )
  } catch (err) {
    console.error('NPC extraction error (non-fatal):', err)
  }

  return Response.json({ id })
}
