import { Redis } from '@upstash/redis'
import { v4 as uuidv4 } from 'uuid'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
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
          variables: { transcript },
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('OpenAI error:', body)
      return Response.json({ error: `OpenAI API error (${res.status}). Check server logs.` }, { status: 502 })
    }

    const data = await res.json()
    // Responses API returns output_text as a convenience field
    generatedText = data.output_text
      ?? data.output?.[0]?.content?.[0]?.text
      ?? JSON.stringify(data)
  } catch (err) {
    return Response.json({ error: `Failed to call OpenAI: ${err.message}` }, { status: 502 })
  }

  // Store result in Redis
  const id = uuidv4()
  await getKv().set(`result:${id}`, {
    id,
    text: generatedText,
    fileName,
    createdAt: new Date().toISOString(),
  })

  return Response.json({ id })
}
