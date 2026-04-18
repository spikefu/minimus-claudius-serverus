# Minimus

A minimal chat app that demonstrates core principles of building with the Claude AI API: prompt caching, model selection, tool use, and history compression.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer) — download and install from the website if you don't have it
- An Anthropic API key — sign up at [console.anthropic.com](https://console.anthropic.com) to get one

To check if Node.js is already installed, open a terminal and run:

```
node --version
```

If you see a version number, you're good to go.

## Setup

**1. Clone or download this project**

If you have Git installed:

```
git clone <repo-url>
cd minimus
```

Or download the ZIP from GitHub, unzip it, and open a terminal in that folder.

**2. Install dependencies**

```
npm install
```

**3. Add your API key**

Copy the example environment file:

```
cp .env.example .env
```

Open `.env` in any text editor and replace `your_key_here` with your actual Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
```

## Running the app

```
npm start
```

Then open your browser and go to:

```
http://localhost:3001
```

You should see the chat interface. Type a message and press Enter to start a conversation.

## What it demonstrates

- **Right model for the task** — uses Claude Sonnet for main responses and the cheaper Claude Haiku for hints and history summarization
- **Prompt caching** — the system prompt is cached so you only pay for it once
- **Tool use** — the AI can save notes mid-conversation using a `save_note` tool
- **History compression** — after 10 messages, older history is automatically summarized to keep costs low

## Troubleshooting

**"ANTHROPIC_API_KEY is not set"** — Make sure you created a `.env` file and that it contains your key (see step 3 above).

**Port already in use** — Change the `PORT` value in your `.env` file to something else like `3002`, then restart.

**`npm install` fails** — Make sure Node.js v18 or newer is installed (`node --version`).
