// Vercel API Route — AI 프록시 (OpenAI 우선, Groq 폴백)
// 호출 경로: /api/ai

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!openaiKey && !groqKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY 또는 GROQ_API_KEY 환경변수가 필요합니다' });
  }

  const { messages, max_tokens = 2500 } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다' });
  }

  const useOpenAI = !!openaiKey;
  const endpoint = useOpenAI
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const apiKey = useOpenAI ? openaiKey : groqKey;
  const model = useOpenAI ? 'gpt-4o-mini' : 'llama-3.1-8b-instant';

  const payload = {
    model,
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    max_tokens,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: `${useOpenAI ? 'OpenAI' : 'Groq'} API 오류 (${response.status})`,
        detail: data,
      });
    }

    const text = data.choices?.[0]?.message?.content || '';

    // 디버그 로그 — outfits 개수 + 각 슬롯 검색어
    try {
      const parsed = JSON.parse(text);
      const outfits = parsed.outfits || [];
      const summary = outfits.map((o, i) => {
        const kws = ['hat', 'top', 'bottom', 'shoes']
          .map((s) => `${s}="${o.items?.[s]?.search_keyword || '?'}"`)
          .join(' ');
        return `  [${i}] title="${o.title || ''}" ${kws}`;
      }).join('\n');
      console.log(`[AI:${useOpenAI ? 'openai' : 'groq'}] mood="${parsed.mood_label || '?'}" outfits=${outfits.length}\n${summary}`);
    } catch {
      console.log(`[AI:${useOpenAI ? 'openai' : 'groq'}] JSON parse failed. Raw (first 400):`, text.slice(0, 400));
    }

    return res.status(200).json({
      id: `${useOpenAI ? 'openai' : 'groq'}-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: data.choices?.[0]?.finish_reason || 'end_turn',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
