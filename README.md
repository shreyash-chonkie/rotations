# Rotations

Rotations is a local-first football puzzle game. Generate a tactical level, record a movement and passing rotation, then play it back to see whether the chance ends in a goal.

## Local development

Install dependencies:

```sh
npm install
```

Run the app:

```sh
npm run dev
```

The frontend runs on `http://localhost:5173` and the local API runs on `http://localhost:5174`.

## Model provider

The API calls OpenRouter and defaults to:

```sh
nvidia/nemotron-3-nano-30b-a3b:free
```

Set your OpenRouter API key before running the app:

```sh
OPENROUTER_API_KEY=your_key_here npm run dev
```

Or create a local `.env` file:

```sh
OPENROUTER_API_KEY=your_key_here
```

You can override the endpoint or model:

```sh
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions OPENROUTER_MODEL=nvidia/nemotron-3-nano-30b-a3b:free npm run dev
```

If the API key or model is unavailable, the game uses a deterministic fallback level so the UI remains playable.
