require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// PRINCIPLE: Right model for the task. Sonnet for reasoning; Haiku for cheap mechanical work.
const MAIN_MODEL  = 'claude-sonnet-4-6';
const CHEAP_MODEL = 'claude-haiku-4-5-20251001';

// PRINCIPLE: Limits on everything.
const MAX_TOKENS      = 1024;  // main response
const SUGGEST_TOKENS  = 80;    // next-step hint — one sentence
const COMPRESS_TOKENS = 256;   // summary — we don't need a novel
const COMPRESS_AFTER  = 10;    // messages before history compression kicks in

// PRINCIPLE: Caching is your lever against cost.
// This block never changes between requests. Pay for it once; essentially free after that.
const STATIC_BLOCK = {
  type: 'text',
  text: `You are a focused thinking partner. Help the user reason through problems clearly and concisely.

You have one tool: save_note. Use it when the conversation produces a key insight, decision, or fact worth keeping.

Style rules:
- Be direct. One idea at a time.
- No filler phrases ("Certainly!", "Great question!", "Of course!").
- When you save a note, mention it in one clause, then move on.`,
  cache_control: { type: 'ephemeral' }
};

// PRINCIPLE: Lean tool definitions. The schema is the contract — nothing extra.
// Two required fields. No optional cruft. No verbose descriptions that eat tokens.
const TOOLS = [{
  name: 'save_note',
  description: 'Persist a key insight or fact for this session',
  input_schema: {
    type: 'object',
    properties: {
      key:   { type: 'string', description: 'Short label (3–5 words)' },
      value: { type: 'string', description: 'The insight to preserve' }
    },
    required: ['key', 'value']
  }
}];

// In-memory store for the session (demo only).
const notes = {};

// PRINCIPLE: Compress the message history. It's worth the cost of a cheap extra call
// to keep the context window from filling with stale turns.
async function compressHistory(messages) {
  const tail = messages.slice(-4);   // keep the last 4 verbatim (2 turns)
  const head = messages.slice(0, -4);

  const msgText = m => typeof m.content === 'string'
    ? m.content
    : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  const { content } = await anthropic.messages.create({
    model: CHEAP_MODEL,
    max_tokens: COMPRESS_TOKENS,
    messages: [{
      role: 'user',
      content: `Summarize this exchange in 2–3 sentences, keeping all key decisions and context:\n\n${
        head.map(m => `${m.role}: ${msgText(m)}`).join('\n')
      }`
    }]
  });

  return [
    { role: 'user',      content: `[Earlier conversation — summarized]\n${content[0].text}` },
    { role: 'assistant', content: 'Understood. I have the context.' },
    ...tail
  ];
}

app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    let { messages } = req.body;

    // Compress if needed, and tell the client so it can sync its local history.
    if (messages.length > COMPRESS_AFTER) {
      messages = await compressHistory(messages);
      send({ type: 'compressed', messages });
    }

    // PRINCIPLE: Split static and dynamic context.
    // Static block is cached (paid once). Dynamic block carries only current state (paid per turn).
    const dynamicBlock = {
      type: 'text',
      text: Object.keys(notes).length
        ? `Session notes:\n${Object.entries(notes).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
        : 'No notes saved yet.'
    };

    // Stream the main response.
    const stream = anthropic.messages.stream({
      model: MAIN_MODEL,
      max_tokens: MAX_TOKENS,
      system: [STATIC_BLOCK, dynamicBlock],
      tools: TOOLS,
      messages
    });

    stream.on('text', text => send({ type: 'text', text }));

    const firstMsg = await stream.finalMessage();
    let lastResponseText = firstMsg.content
      .filter(b => b.type === 'text').map(b => b.text).join('');

    // Handle tool use: execute, then follow up for the model's closing remark.
    if (firstMsg.stop_reason === 'tool_use') {
      const toolResults = firstMsg.content
        .filter(b => b.type === 'tool_use')
        .map(b => {
          if (b.name === 'save_note') {
            notes[b.input.key] = b.input.value;
            send({ type: 'note_saved', key: b.input.key, value: b.input.value });
            return { type: 'tool_result', tool_use_id: b.id, content: `Saved "${b.input.key}".` };
          }
          return { type: 'tool_result', tool_use_id: b.id, content: 'Unknown tool.' };
        });

      const followUp = await anthropic.messages.create({
        model: MAIN_MODEL,
        max_tokens: MAX_TOKENS,
        system: [STATIC_BLOCK, dynamicBlock],
        tools: TOOLS,
        messages: [
          ...messages,
          { role: 'assistant', content: firstMsg.content },
          { role: 'user',      content: toolResults }
        ]
      });

      lastResponseText = followUp.content
        .filter(b => b.type === 'text').map(b => b.text).join('');

      if (lastResponseText) send({ type: 'text', text: lastResponseText });
    }

    // PRINCIPLE: Let the model plan the next step.
    // A cheap call asking "what's the best next move?" costs little but guides the user forward.
    const { content: hint } = await anthropic.messages.create({
      model: CHEAP_MODEL,
      max_tokens: SUGGEST_TOKENS,
      messages: [
        ...messages,
        { role: 'assistant', content: lastResponseText },
        { role: 'user', content: 'One sentence only: what is the single most valuable next question or action for the user right now?' }
      ]
    });
    send({ type: 'suggestion', text: hint[0].text });

    send({ type: 'done' });
  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
  }

  res.end();
});

app.get('/api/notes', (_req, res) => res.json(notes));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — copy .env.example to .env');
    process.exit(1);
  }
  console.log(`minimus → http://localhost:${PORT}`);
});
