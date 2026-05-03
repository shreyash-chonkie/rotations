import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 5174);
const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "google/gemma-4-E4B-it";

app.use(express.json({ limit: "1mb" }));

const fallbackLevels = [
  {
    id: "wide-overload-1",
    title: "Wide Overload",
    difficulty: 1,
    brief:
      "Blue have pinned Red back. Use the winger and central runner to open a clean shot across goal.",
    attackingTeam: "Blue",
    defendingTeam: "Red",
    ballCarrierId: "h2",
    players: [
      { id: "h1", name: "CB", team: "home", x: 18, y: 50 },
      { id: "h2", name: "CM", team: "home", x: 38, y: 50 },
      { id: "h3", name: "RW", team: "home", x: 58, y: 28 },
      { id: "h4", name: "ST", team: "home", x: 70, y: 50 },
      { id: "h5", name: "LW", team: "home", x: 55, y: 72 },
      { id: "a0", name: "GK", team: "away", x: 96, y: 50, speed: 52, reaction: 88, mistake: 0.06 },
      { id: "a1", name: "DM", team: "away", x: 52, y: 50, speed: 72, reaction: 84, mistake: 0.12 },
      { id: "a2", name: "LB", team: "away", x: 68, y: 30, speed: 86, reaction: 66, mistake: 0.22 },
      { id: "a3", name: "CB", team: "away", x: 78, y: 46, speed: 58, reaction: 88, mistake: 0.08 },
      { id: "a4", name: "CB", team: "away", x: 78, y: 58, speed: 64, reaction: 74, mistake: 0.18 },
      { id: "a5", name: "RB", team: "away", x: 67, y: 72, speed: 82, reaction: 61, mistake: 0.28 }
    ]
  },
  {
    id: "half-space-2",
    title: "Half-Space Slip",
    difficulty: 2,
    brief:
      "The first line is beaten, but the center is crowded. Rotate the striker away, find the half-space, then shoot.",
    attackingTeam: "Blue",
    defendingTeam: "Red",
    ballCarrierId: "h1",
    players: [
      { id: "h1", name: "6", team: "home", x: 42, y: 54 },
      { id: "h2", name: "8", team: "home", x: 54, y: 42 },
      { id: "h3", name: "10", team: "home", x: 61, y: 56 },
      { id: "h4", name: "9", team: "home", x: 73, y: 50 },
      { id: "h5", name: "WF", team: "home", x: 63, y: 76 },
      { id: "a0", name: "GK", team: "away", x: 96, y: 50, speed: 55, reaction: 91, mistake: 0.05 },
      { id: "a1", name: "6", team: "away", x: 56, y: 52, speed: 74, reaction: 90, mistake: 0.1 },
      { id: "a2", name: "8", team: "away", x: 61, y: 42, speed: 79, reaction: 83, mistake: 0.14 },
      { id: "a3", name: "CB", team: "away", x: 78, y: 45, speed: 61, reaction: 91, mistake: 0.07 },
      { id: "a4", name: "CB", team: "away", x: 79, y: 57, speed: 68, reaction: 81, mistake: 0.13 },
      { id: "a5", name: "FB", team: "away", x: 71, y: 76, speed: 88, reaction: 69, mistake: 0.19 }
    ]
  }
];

function fallbackLevel(previousLevel) {
  if (!previousLevel) {
    return fallbackLevels[0];
  }

  const base = fallbackLevels[Math.min((previousLevel.difficulty ?? 1), fallbackLevels.length - 1)];
  return {
    ...base,
    id: `${base.id}-${Date.now()}`,
    difficulty: (previousLevel.difficulty ?? 1) + 1,
    title: `${base.title} ${previousLevel.difficulty + 1}`,
    players: base.players.map((player) => ({
      ...player,
      x: Math.max(8, Math.min(92, player.x + (player.team === "away" ? -2 : 2))),
      y: Math.max(12, Math.min(88, player.y + (player.id.charCodeAt(1) % 3) - 1))
    }))
  };
}

function normalizeLevel(raw, previousLevel) {
  if (!raw || !Array.isArray(raw.players)) {
    throw new Error("Missing players array");
  }

  const players = raw.players
    .filter((player) => player && typeof player.id === "string")
    .slice(0, 12)
    .map((player, index) => {
      const team = player.team === "away" ? "away" : "home";
      const normalized = {
        id: String(player.id),
        name: String(player.name ?? player.id).slice(0, 8),
        team,
        x: clampNumber(player.x, 5, 95, 50),
        y: clampNumber(player.y, 8, 92, 50)
      };

      if (team === "away") {
        return {
          ...normalized,
          speed: clampNumber(player.speed, 0, 100, 62 + ((index * 11) % 31)),
          reaction: clampNumber(player.reaction, 0, 100, 60 + ((index * 13) % 33)),
          mistake: clampNumber(player.mistake, 0, 1, 0.08 + (index % 5) * 0.04)
        };
      }

      return normalized;
    });

  if (!players.some((player) => player.team === "away" && isGoalkeeper(player))) {
    players.push({
      id: "a0",
      name: "GK",
      team: "away",
      x: 96,
      y: 50,
      speed: 54,
      reaction: 90,
      mistake: 0.06
    });
  }

  const homePlayers = players.filter((player) => player.team === "home");
  const ballCarrierId = homePlayers.some((player) => player.id === raw.ballCarrierId)
    ? raw.ballCarrierId
    : homePlayers[0]?.id;

  if (!ballCarrierId || homePlayers.length < 4 || players.filter((player) => player.team === "away").length < 4) {
    throw new Error("Level needs at least four players per team and a home ball carrier");
  }

  return {
    id: String(raw.id ?? `level-${Date.now()}`),
    title: String(raw.title ?? "Generated Rotation").slice(0, 40),
    difficulty: clampNumber(raw.difficulty, 1, 99, (previousLevel?.difficulty ?? 0) + 1),
    brief: String(raw.brief ?? "Break the defensive line and create a shot.").slice(0, 240),
    attackingTeam: String(raw.attackingTeam ?? "Blue").slice(0, 24),
    defendingTeam: String(raw.defendingTeam ?? "Red").slice(0, 24),
    ballCarrierId,
    players
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function isGoalkeeper(player) {
  const id = String(player.id ?? "").toLowerCase();
  const name = String(player.name ?? "").toLowerCase();
  return id.includes("gk") || name === "gk" || name.includes("keeper") || name.includes("goalkeeper");
}

async function generateWithOllama(previousLevel, solution) {
  const prompt = `You generate JSON levels for a football/soccer puzzle game named Rotations.
The user controls the team with the ball. Coordinates are normalized: x 0 is the user's own goal, x 100 is the target goal, y 0 is top touchline, y 100 is bottom touchline.
Return only valid JSON with this shape:
{
  "id": "short-slug",
  "title": "short title",
  "difficulty": number,
  "brief": "one or two tactical sentences",
  "attackingTeam": "Blue",
  "defendingTeam": "Red",
  "ballCarrierId": "h1",
  "players": [
    {"id":"h1","name":"CM","team":"home","x":40,"y":50},
    {"id":"a0","name":"GK","team":"away","x":96,"y":50,"speed":55,"reaction":90,"mistake":0.05},
    {"id":"a1","name":"CB","team":"away","x":78,"y":48,"speed":72,"reaction":84,"mistake":0.12}
  ]
}
Use exactly 5 home players and 6 away players. One away player must always be a goalkeeper named "GK" positioned near x=96, y=50. Home players attack toward x=100. Every away player must include speed from 0 to 100, reaction from 0 to 100, and mistake from 0 to 1. Make the level more difficult than the previous one by tightening spaces, adding cover shadows, improving defender scores, or forcing an extra rotation.

Previous level:
${JSON.stringify(previousLevel ?? null)}

Previous solution:
${JSON.stringify(solution ?? null)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.8
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama responded ${response.status}`);
    }

    const data = await response.json();
    return normalizeLevel(JSON.parse(data.response), previousLevel);
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, model: ollamaModel, ollamaUrl });
});

app.post("/api/levels", async (request, response) => {
  const { previousLevel, solution } = request.body ?? {};

  try {
    const level = await generateWithOllama(previousLevel, solution);
    response.json({ level, source: "ollama", model: ollamaModel });
  } catch (error) {
    response.json({
      level: fallbackLevel(previousLevel),
      source: "fallback",
      model: ollamaModel,
      warning: error instanceof Error ? error.message : "Local model unavailable"
    });
  }
});

app.listen(port, () => {
  console.log(`Rotations API listening on http://localhost:${port}`);
});
