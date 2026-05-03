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

## Local model

The API calls Ollama at `http://localhost:11434` and defaults to the instruction-tuned model:

```sh
google/gemma-4-E4B-it
```

You can override the local runtime or model tag:

```sh
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=google/gemma-4-E4B-it npm run dev
```

If the model is unavailable, the game uses a deterministic fallback level so the UI remains playable.
