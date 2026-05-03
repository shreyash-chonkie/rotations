import express from "express";
import { existsSync, readFileSync } from "node:fs";

loadDotEnv();

const app = express();
const port = Number(process.env.PORT ?? 5174);
const openRouterUrl =
  process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const openRouterModel =
  process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-nano-30b-a3b:free";
const openRouterProviderSort =
  process.env.OPENROUTER_PROVIDER_SORT ?? "throughput";
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const levelBufferTargetSize = 3;
const levelBuffers = new Map();
const servedLevelFingerprints = new Set();
const maxRememberedLevelFingerprints = 80;
const openRouterModelName = "NVIDIA Nemotron 3 Nano";
let levelBufferStarted = false;

app.use(express.json({ limit: "1mb" }));

function loadDotEnv() {
  if (!existsSync(".env")) {
    return;
  }

  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    if (process.env[key]) {
      continue;
    }

    process.env[key] = valueParts
      .join("=")
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
}

const fallbackLevelConfigs = [
  {
    id: "wide-overload-1",
    title: "Wide Overload",
    difficulty: 1,
    brief:
      "Blue have pinned Red back, but the nearest passing lanes are screened and the box is crowded.",
    ballCarrierId: "h6",
    home: [
      ["GK", 6, 50],
      ["LCB", 20, 34],
      ["CB", 18, 50],
      ["RCB", 20, 66],
      ["LWB", 39, 18],
      ["RWB", 39, 82],
      ["DM", 42, 50],
      ["LCM", 54, 38],
      ["RW", 66, 24],
      ["ST", 74, 50],
      ["LW", 66, 74],
    ],
    away: [
      ["GK", 96, 50],
      ["LWB", 84, 20],
      ["LCB", 86, 36],
      ["CB", 88, 50],
      ["RCB", 86, 64],
      ["RWB", 84, 80],
      ["LCM", 70, 36],
      ["CM", 68, 50],
      ["RCM", 70, 64],
      ["ST", 58, 43],
      ["ST", 58, 57],
    ],
  },
  {
    id: "half-space-slip-2",
    title: "Half-Space Slip",
    difficulty: 2,
    brief:
      "Blue build against a compact back four with pressure arriving from midfield.",
    ballCarrierId: "h5",
    home: [
      ["GK", 6, 50],
      ["LB", 22, 22],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 22, 78],
      ["DM", 40, 50],
      ["LCM", 52, 36],
      ["RCM", 52, 64],
      ["RW", 70, 26],
      ["ST", 76, 50],
      ["LW", 70, 74],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 82, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 82, 76],
      ["DM", 68, 50],
      ["LCM", 62, 36],
      ["RCM", 62, 64],
      ["RW", 56, 26],
      ["ST", 54, 50],
      ["LW", 56, 74],
    ],
  },
  {
    id: "third-man-run-3",
    title: "Third-Man Run",
    difficulty: 3,
    brief:
      "Blue face a narrow midfield block that protects the obvious central pass.",
    ballCarrierId: "h7",
    home: [
      ["GK", 6, 50],
      ["LB", 20, 20],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 20, 80],
      ["LCM", 43, 38],
      ["CM", 40, 50],
      ["RCM", 43, 62],
      ["AM", 58, 50],
      ["ST", 74, 42],
      ["ST", 74, 58],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 84, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 84, 76],
      ["LM", 68, 28],
      ["LCM", 66, 43],
      ["RCM", 66, 57],
      ["RM", 68, 72],
      ["ST", 56, 42],
      ["ST", 56, 58],
    ],
  },
  {
    id: "box-midfield-4",
    title: "Box Midfield",
    difficulty: 4,
    brief:
      "Blue's box midfield has Red compact, but the forwards are tightly marked.",
    ballCarrierId: "h5",
    home: [
      ["GK", 6, 50],
      ["LB", 20, 22],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 20, 78],
      ["LDM", 40, 42],
      ["RDM", 40, 58],
      ["LAM", 58, 35],
      ["RAM", 58, 65],
      ["ST", 74, 42],
      ["ST", 74, 58],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 84, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 84, 76],
      ["LDM", 70, 42],
      ["RDM", 70, 58],
      ["LAM", 60, 35],
      ["RAM", 60, 65],
      ["ST", 52, 44],
      ["ST", 52, 56],
    ],
  },
  {
    id: "back-five-switch-5",
    title: "Back-Five Switch",
    difficulty: 5,
    brief:
      "Red defend with five across the back and leave little room near the first receiver.",
    ballCarrierId: "h6",
    home: [
      ["GK", 6, 50],
      ["LCB", 20, 38],
      ["RCB", 20, 62],
      ["LB", 30, 22],
      ["RB", 30, 78],
      ["DM", 42, 50],
      ["LCM", 54, 38],
      ["RCM", 54, 62],
      ["RW", 72, 26],
      ["ST", 78, 50],
      ["LW", 72, 74],
    ],
    away: [
      ["GK", 96, 50],
      ["LWB", 84, 18],
      ["LCB", 86, 34],
      ["CB", 88, 50],
      ["RCB", 86, 66],
      ["RWB", 84, 82],
      ["LCM", 70, 40],
      ["CM", 68, 50],
      ["RCM", 70, 60],
      ["ST", 58, 44],
      ["ST", 58, 56],
    ],
  },
  {
    id: "wingback-underlap-6",
    title: "Wingback Underlap",
    difficulty: 6,
    brief:
      "Blue's wingback is high, while Red's double pivot is positioned to delay central access.",
    ballCarrierId: "h4",
    home: [
      ["GK", 6, 50],
      ["LCB", 20, 34],
      ["CB", 18, 50],
      ["RCB", 20, 66],
      ["LWB", 42, 18],
      ["RWB", 42, 82],
      ["LCM", 50, 42],
      ["RCM", 50, 58],
      ["AM", 62, 50],
      ["ST", 76, 42],
      ["ST", 76, 58],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 84, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 84, 76],
      ["LDM", 70, 43],
      ["RDM", 70, 57],
      ["LW", 60, 28],
      ["AM", 58, 50],
      ["RW", 60, 72],
      ["ST", 50, 50],
    ],
  },
  {
    id: "diamond-break-7",
    title: "Diamond Break",
    difficulty: 7,
    brief:
      "Red's midfield diamond blocks the direct route into the forwards.",
    ballCarrierId: "h5",
    home: [
      ["GK", 6, 50],
      ["LB", 20, 22],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 20, 78],
      ["DM", 40, 50],
      ["LCM", 52, 38],
      ["RCM", 52, 62],
      ["AM", 64, 50],
      ["ST", 78, 42],
      ["ST", 78, 58],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 84, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 84, 76],
      ["DM", 70, 50],
      ["LCM", 62, 38],
      ["RCM", 62, 62],
      ["AM", 54, 50],
      ["ST", 46, 42],
      ["ST", 46, 58],
    ],
  },
  {
    id: "low-block-ladder-8",
    title: "Low-Block Ladder",
    difficulty: 8,
    brief:
      "Red sit in a 5-4-1 low block with the central lane heavily protected.",
    ballCarrierId: "h6",
    home: [
      ["GK", 6, 50],
      ["LB", 22, 20],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 22, 80],
      ["DM", 40, 50],
      ["LCM", 52, 38],
      ["RCM", 52, 62],
      ["RW", 70, 24],
      ["ST", 78, 50],
      ["LW", 70, 76],
    ],
    away: [
      ["GK", 96, 50],
      ["LWB", 88, 18],
      ["LCB", 88, 34],
      ["CB", 90, 50],
      ["RCB", 88, 66],
      ["RWB", 88, 82],
      ["LM", 76, 26],
      ["LCM", 74, 43],
      ["RCM", 74, 57],
      ["RM", 76, 74],
      ["ST", 62, 50],
    ],
  },
  {
    id: "inside-channel-9",
    title: "Inside Channel",
    difficulty: 9,
    brief:
      "Blue attack a 3-4-3 press with Red's wingback close enough to recover.",
    ballCarrierId: "h7",
    home: [
      ["GK", 6, 50],
      ["LB", 20, 22],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 20, 78],
      ["DM", 40, 50],
      ["LCM", 52, 38],
      ["RCM", 52, 62],
      ["RW", 72, 26],
      ["ST", 78, 50],
      ["LW", 72, 74],
    ],
    away: [
      ["GK", 96, 50],
      ["LCB", 86, 34],
      ["CB", 88, 50],
      ["RCB", 86, 66],
      ["LWB", 72, 22],
      ["LCM", 68, 42],
      ["RCM", 68, 58],
      ["RWB", 72, 78],
      ["RW", 56, 28],
      ["ST", 52, 50],
      ["LW", 56, 72],
    ],
  },
  {
    id: "false-nine-drop-10",
    title: "False Nine Drop",
    difficulty: 10,
    brief:
      "Blue face a flat back four that is holding its line and screening the central forward.",
    ballCarrierId: "h8",
    home: [
      ["GK", 6, 50],
      ["LB", 20, 22],
      ["LCB", 22, 42],
      ["RCB", 22, 58],
      ["RB", 20, 78],
      ["LDM", 40, 42],
      ["RDM", 40, 58],
      ["AM", 58, 50],
      ["RW", 72, 26],
      ["CF", 66, 50],
      ["LW", 72, 74],
    ],
    away: [
      ["GK", 96, 50],
      ["LB", 84, 24],
      ["LCB", 84, 42],
      ["RCB", 84, 58],
      ["RB", 84, 76],
      ["LM", 68, 28],
      ["LCM", 66, 43],
      ["RCM", 66, 57],
      ["RM", 68, 72],
      ["ST", 56, 42],
      ["ST", 56, 58],
    ],
  },
].map(buildFallbackLevel);

const fallbackHomePlayers = [
  { name: "GK", x: 6, y: 50 },
  { name: "LCB", x: 20, y: 34 },
  { name: "CB", x: 18, y: 50 },
  { name: "RCB", x: 20, y: 66 },
  { name: "LWB", x: 38, y: 20 },
  { name: "RWB", x: 38, y: 80 },
  { name: "DM", x: 42, y: 50 },
  { name: "LCM", x: 52, y: 38 },
  { name: "RCM", x: 52, y: 62 },
  { name: "ST", x: 72, y: 42 },
  { name: "ST", x: 72, y: 58 },
];

const fallbackAwayPlayers = [
  { name: "GK", x: 96, y: 50 },
  { name: "LWB", x: 84, y: 20 },
  { name: "LCB", x: 86, y: 36 },
  { name: "CB", x: 88, y: 50 },
  { name: "RCB", x: 86, y: 64 },
  { name: "RWB", x: 84, y: 80 },
  { name: "LCM", x: 70, y: 36 },
  { name: "CM", x: 68, y: 50 },
  { name: "RCM", x: 70, y: 64 },
  { name: "ST", x: 58, y: 43 },
  { name: "ST", x: 58, y: 57 },
];

function buildFallbackLevel(config) {
  return {
    id: config.id,
    title: config.title,
    difficulty: config.difficulty,
    brief: config.brief,
    attackingTeam: "Blue",
    defendingTeam: "Red",
    ballCarrierId: config.ballCarrierId,
    players: [
      ...config.home.map(([name, x, y], index) => ({
        id: `h${index}`,
        name,
        team: "home",
        x,
        y,
      })),
      ...config.away.map(([name, x, y], index) => ({
        id: `a${index}`,
        name,
        team: "away",
        x,
        y,
        ...fallbackDefenderStats(index),
      })),
    ],
  };
}

function fallbackDefenderStats(index) {
  if (index === 0) {
    return { speed: 42, reaction: 76, mistake: 0.12 };
  }

  return {
    speed: Math.min(88, 62 + ((index * 7) % 24)),
    reaction: Math.min(90, 64 + ((index * 11) % 24)),
    mistake: Math.round((0.1 + (index % 5) * 0.03) * 100) / 100,
  };
}

function fallbackLevel(previousLevel) {
  for (let attempt = 0; attempt < fallbackLevelConfigs.length; attempt += 1) {
    const base =
      fallbackLevelConfigs[
        Math.floor(Math.random() * fallbackLevelConfigs.length)
      ];
    const level = normalizeLevel(
      {
        ...base,
        id: `${base.id}-${Date.now()}`,
        difficulty: (previousLevel?.difficulty ?? 0) + 1,
        title: previousLevel
          ? `${base.title} ${previousLevel.difficulty + 1}`
          : base.title,
      },
      previousLevel,
      { repair: true },
    );

    if (!servedLevelFingerprints.has(levelFingerprint(level))) {
      rememberServedLevel(level);
      return level;
    }
  }

  const level = normalizeLevel(
    {
      ...fallbackLevelConfigs[Math.floor(Math.random() * fallbackLevelConfigs.length)],
      id: `fallback-${Date.now()}`,
      difficulty: (previousLevel?.difficulty ?? 0) + 1,
    },
    previousLevel,
    { repair: true },
  );
  rememberServedLevel(level);
  return level;
}

const formationRoles = {
  "4-3-3": ["GK", "LB", "LCB", "RCB", "RB", "DM", "LCM", "RCM", "LW", "ST", "RW"],
  "4-2-3-1": ["GK", "LB", "LCB", "RCB", "RB", "LDM", "RDM", "LW", "AM", "RW", "ST"],
  "4-4-2": ["GK", "LB", "LCB", "RCB", "RB", "LM", "LCM", "RCM", "RM", "LST", "RST"],
  "3-4-3": ["GK", "LCB", "CB", "RCB", "LWB", "LCM", "RCM", "RWB", "LW", "ST", "RW"],
  "3-5-2": ["GK", "LCB", "CB", "RCB", "LWB", "LCM", "CM", "RCM", "RWB", "LST", "RST"],
  "5-3-2": ["GK", "LWB", "LCB", "CB", "RCB", "RWB", "LCM", "CM", "RCM", "LST", "RST"],
  "5-4-1": ["GK", "LWB", "LCB", "CB", "RCB", "RWB", "LM", "LCM", "RCM", "RM", "ST"],
  "3-2-5": ["GK", "LCB", "CB", "RCB", "LDM", "RDM", "LW", "LAM", "ST", "RAM", "RW"],
};

const defaultHomeFormation = "3-2-5";
const defaultAwayFormation = "5-4-1";
const allowedTweaks = new Set([
  "wide_high",
  "wide_deep",
  "half_space",
  "between_lines",
  "between_cbs",
  "narrow",
  "cover_channel",
  "press_ball",
  "screen_pivot",
  "hold_line",
]);

function buildLevelFromSpec(spec, previousLevel) {
  const homeFormation = normalizeFormation(
    spec?.homeFormation,
    defaultHomeFormation,
  );
  const awayFormation = normalizeFormation(
    spec?.awayFormation,
    defaultAwayFormation,
  );
  const homeTweaks = normalizeTweaks(spec?.homeTweaks);
  const awayTweaks = normalizeTweaks(spec?.awayTweaks);
  const chaos = buildChaosOptions(spec, previousLevel);
  const homePlayers = formationPlayers(
    "home",
    homeFormation,
    homeTweaks,
    spec?.attackingFocus,
    chaos,
  );
  const awayPlayers = formationPlayers(
    "away",
    awayFormation,
    awayTweaks,
    spec?.defensiveBlock,
    chaos,
  );
  const ballCarrierId = chooseRoleCarrier(
    normalizeRoleName(spec?.ballCarrierRole ?? spec?.ballCarrier, "CM"),
    homePlayers,
  );

  return {
    id: String(spec?.id ?? `level-${Date.now()}`),
    title: String(spec?.title ?? "Generated Rotation"),
    difficulty: spec?.difficulty,
    brief: normalizeBrief(spec?.brief, spec),
    attackingTeam: "Blue",
    defendingTeam: "Red",
    ballCarrierId,
    players: [...homePlayers, ...awayPlayers],
  };
}

function normalizeFormation(value, fallback) {
  const formation = String(value ?? fallback).trim();
  return formationRoles[formation] ? formation : fallback;
}

function normalizeTweaks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([role, tweak]) => [
        normalizeRoleName(role, ""),
        String(tweak ?? "").trim(),
      ])
      .filter(([role, tweak]) => role && allowedTweaks.has(tweak)),
  );
}

function formationPlayers(team, formation, tweaks, scenario, chaos) {
  return formationRoles[formation].map((role, index) => {
    const point = applyChaos(
      applyRoleTweak(
        rolePoint(role, team, scenario, chaos),
        role,
        team,
        tweaks[role],
      ),
      role,
      team,
      index,
      chaos,
    );
    const player = {
      id: `${team === "home" ? "h" : "a"}${index}`,
      name: role,
      team,
      x: point.x,
      y: point.y,
    };

    return team === "away"
      ? { ...player, ...fallbackDefenderStats(index) }
      : player;
  });
}

function rolePoint(role, team, scenario, chaos) {
  const isHome = team === "home";
  const roleType = roleTypeFor(role);
  const lineShift = lineHeightShift(roleType, team, chaos.lineHeight);
  const compactness = roleType === "gk" ? 0 : chaos.compactness;
  const xLines = isHome
    ? { gk: 6, defender: 22, wingback: 40, midfield: 48, attackingMid: 60, forward: 74 }
    : { gk: 96, defender: 86, wingback: 84, midfield: 70, attackingMid: 62, forward: 56 };
  const scenarioShift = scenarioOffset(String(scenario ?? ""), team);
  return {
    x: xLines[roleType] + scenarioShift.x + lineShift,
    y: 50 + (roleY(role) - 50) * (1 - compactness * 0.22) + scenarioShift.y,
  };
}

function buildChaosOptions(spec, previousLevel) {
  const seedText = JSON.stringify({
    id: spec?.id,
    title: spec?.title,
    focus: spec?.attackingFocus,
    block: spec?.defensiveBlock,
    previous: previousLevel?.id,
    difficulty: previousLevel?.difficulty,
  });
  const random = seededRandom(seedText);
  const compactness = clampNumber(
    spec?.compactness,
    0.15,
    0.75,
    0.22 + random() * 0.38,
  );
  const lineHeight = normalizeEnum(
    spec?.lineHeight,
    ["deep", "mid", "high"],
    random() < 0.34 ? "deep" : random() < 0.68 ? "mid" : "high",
  );
  const pressureSide = normalizeEnum(
    spec?.pressureSide,
    ["left", "right", "central"],
    random() < 0.36 ? "left" : random() < 0.72 ? "right" : "central",
  );
  const asymmetry = normalizeEnum(
    spec?.asymmetry,
    ["left", "right", "none"],
    random() < 0.42 ? "left" : random() < 0.84 ? "right" : "none",
  );

  return { random, compactness, lineHeight, pressureSide, asymmetry };
}

function lineHeightShift(roleType, team, lineHeight) {
  if (roleType === "gk") {
    return 0;
  }

  const direction = team === "home" ? 1 : -1;
  const scale = roleType === "defender" ? 0.55 : roleType === "forward" ? 1 : 0.75;
  if (lineHeight === "high") {
    return direction * 4.5 * scale;
  }
  if (lineHeight === "deep") {
    return -direction * 4 * scale;
  }
  return 0;
}

function applyChaos(point, role, team, index, chaos) {
  if (role === "GK") {
    return point;
  }

  const next = { ...point };
  const direction = team === "home" ? 1 : -1;
  const sideSign = role.startsWith("L") ? -1 : role.startsWith("R") ? 1 : 0;
  const randomX = (chaos.random() - 0.5) * 5.2;
  const randomY = (chaos.random() - 0.5) * 6.8;

  next.x += randomX;
  next.y += randomY;

  if (chaos.pressureSide === "left") {
    next.y -= team === "away" ? 3.6 : 1.8;
  }
  if (chaos.pressureSide === "right") {
    next.y += team === "away" ? 3.6 : 1.8;
  }

  if (chaos.asymmetry !== "none") {
    const asymmetrySign = chaos.asymmetry === "right" ? 1 : -1;
    if (sideSign === asymmetrySign) {
      next.x += direction * (2.2 + (index % 3));
    } else if (sideSign === -asymmetrySign) {
      next.x -= direction * 1.5;
    }
  }

  const bounds = playerBounds(team, false);
  return {
    x: clampNumber(next.x, bounds.minX, bounds.maxX, point.x),
    y: clampNumber(next.y, bounds.minY, bounds.maxY, point.y),
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roleTypeFor(role) {
  if (role === "GK") {
    return "gk";
  }
  if (role.includes("CB") || role === "LB" || role === "RB") {
    return "defender";
  }
  if (role.includes("WB")) {
    return "wingback";
  }
  if (role.includes("AM")) {
    return "attackingMid";
  }
  if (role.includes("W") || role.includes("ST") || role === "CF") {
    return "forward";
  }
  return "midfield";
}

function roleY(role) {
  if (role.startsWith("LWB")) return 18;
  if (role.startsWith("RWB")) return 82;
  if (role === "LB" || role === "LW") return 24;
  if (role === "RB" || role === "RW") return 76;
  if (role === "LM") return 30;
  if (role === "RM") return 70;
  if (role.startsWith("LCB")) return 38;
  if (role.startsWith("RCB")) return 62;
  if (role.startsWith("LDM") || role.startsWith("LCM") || role.startsWith("LAM") || role.startsWith("LST")) return 42;
  if (role.startsWith("RDM") || role.startsWith("RCM") || role.startsWith("RAM") || role.startsWith("RST")) return 58;
  return 50;
}

function scenarioOffset(value, team) {
  const direction = team === "home" ? 1 : -1;
  if (value.includes("low")) return { x: direction * 3, y: 0 };
  if (value.includes("press")) return { x: direction * 5, y: 0 };
  if (value.includes("wide")) return { x: 0, y: 0 };
  return { x: 0, y: 0 };
}

function applyRoleTweak(point, role, team, tweak) {
  const direction = team === "home" ? 1 : -1;
  const next = { ...point };

  if (tweak === "wide_high") {
    next.x += direction * 7;
    next.y = role.startsWith("L") ? 16 : role.startsWith("R") ? 84 : next.y;
  }
  if (tweak === "wide_deep") {
    next.x -= direction * 7;
    next.y = role.startsWith("L") ? 20 : role.startsWith("R") ? 80 : next.y;
  }
  if (tweak === "half_space") {
    next.x += direction * 4;
    next.y = role.startsWith("R") ? 62 : role.startsWith("L") ? 38 : next.y;
  }
  if (tweak === "between_lines") {
    next.x += direction * 6;
  }
  if (tweak === "between_cbs") {
    next.x += direction * 8;
    next.y = 50;
  }
  if (tweak === "narrow") {
    next.y += (50 - next.y) * 0.45;
  }
  if (tweak === "cover_channel") {
    next.x -= direction * 3;
    next.y = role.startsWith("R") ? 64 : role.startsWith("L") ? 36 : next.y;
  }
  if (tweak === "press_ball") {
    next.x -= direction * 7;
  }
  if (tweak === "screen_pivot") {
    next.x -= direction * 3;
    next.y = 50;
  }

  const bounds = playerBounds(team, role === "GK");
  return {
    x: clampNumber(next.x, bounds.minX, bounds.maxX, point.x),
    y: clampNumber(next.y, bounds.minY, bounds.maxY, point.y),
  };
}

function chooseRoleCarrier(role, players) {
  const exact = players.find(
    (player) => player.name === role && !isGoalkeeper(player),
  );
  if (exact) {
    return exact.id;
  }

  const close = players.find(
    (player) => player.name.includes(role) && !isGoalkeeper(player),
  );
  return close?.id ?? chooseBallCarrierId(null, players);
}

function normalizeBrief(value, spec) {
  const brief = String(value ?? "").trim();
  const lower = brief.toLowerCase();
  const givesAnswer =
    /\b(use|rotate|find|switch|drop|clip|play|pass|run|shoot|attack)\b/.test(
      lower,
    );

  if (!brief || givesAnswer) {
    const block = String(spec?.defensiveBlock ?? "compact").replace(/_/g, " ");
    const focus = String(spec?.attackingFocus ?? "central access").replace(/_/g, " ");
    return `Blue have possession against a ${block} Red shape. The ${focus} route is contested and the obvious forward pass is covered.`;
  }

  return brief.slice(0, 240);
}

function normalizeLevel(raw, previousLevel, options = {}) {
  if (!raw) {
    throw new Error("Missing level");
  }

  if (!Array.isArray(raw.players)) {
    raw = buildLevelFromSpec(raw, previousLevel);
  }

  if (!Array.isArray(raw.players)) {
    throw new Error("Missing players array");
  }

  const rawPlayers = raw.players.filter(
    (player) => player && typeof player === "object",
  );
  const homePlayers = normalizeTeam(
    rawPlayers,
    "home",
    fallbackHomePlayers,
    Boolean(options.repair),
  );
  const awayPlayers = normalizeTeam(
    rawPlayers,
    "away",
    fallbackAwayPlayers,
    Boolean(options.repair),
  );
  const players = spreadPlayers([...homePlayers, ...awayPlayers]);
  const ballCarrierId = chooseBallCarrierId(raw.ballCarrierId, players);

  return {
    id: String(raw.id ?? `level-${Date.now()}`),
    title: String(raw.title ?? "Generated Rotation").slice(0, 40),
    difficulty: clampNumber(
      raw.difficulty,
      1,
      99,
      (previousLevel?.difficulty ?? 0) + 1,
    ),
    brief: normalizeBrief(raw.brief, raw),
    attackingTeam: String(raw.attackingTeam ?? "Blue").slice(0, 24),
    defendingTeam: String(raw.defendingTeam ?? "Red").slice(0, 24),
    ballCarrierId,
    players,
  };
}

function levelFingerprint(level) {
  const roleShape = level.players
    .map((player) => `${player.team}:${player.name}:${Math.round(player.x / 4)}:${Math.round(player.y / 4)}`)
    .join("|");
  return [
    String(level.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    String(level.brief ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80),
    level.ballCarrierId,
    roleShape,
  ].join("::");
}

function rememberServedLevel(level) {
  servedLevelFingerprints.add(levelFingerprint(level));
  while (servedLevelFingerprints.size > maxRememberedLevelFingerprints) {
    const oldest = servedLevelFingerprints.values().next().value;
    servedLevelFingerprints.delete(oldest);
  }
}

function normalizeTeam(rawPlayers, team, fallbackPlayers, repair) {
  const prefix = team === "home" ? "h" : "a";
  const sameTeam = rawPlayers.filter((player) => player.team === team);
  const rawKeeper = sameTeam.find(isGoalkeeper);
  const outfield = sameTeam.filter((player) => !isGoalkeeper(player));

  if (
    !repair &&
    (!rawKeeper || outfield.length !== 10 || sameTeam.length !== 11)
  ) {
    throw new Error(
      `Model returned invalid ${team} roster: expected exactly 1 goalkeeper and 10 outfield players`,
    );
  }

  const ordered = [rawKeeper ?? fallbackPlayers[0], ...outfield.slice(0, 10)];

  while (repair && ordered.length < 11) {
    ordered.push(fallbackPlayers[ordered.length]);
  }

  return ordered
    .slice(0, 11)
    .map((raw, index) =>
      normalizePlayer(
        raw,
        team,
        `${prefix}${index}`,
        fallbackPlayers[index],
        index,
      ),
    );
}

function normalizePlayer(raw, team, id, fallback, index) {
  const keeper = index === 0 || isGoalkeeper(raw);
  const bounds = playerBounds(team, keeper);
  const name = keeper
    ? "GK"
    : normalizeRoleName(raw?.name ?? fallback.name, fallback.name);
  const player = {
    id,
    name,
    team,
    x: clampNumber(raw?.x, bounds.minX, bounds.maxX, fallback.x),
    y: clampNumber(raw?.y, bounds.minY, bounds.maxY, fallback.y),
  };

  if (team === "away") {
    return {
      ...player,
      speed: clampNumber(
        raw?.speed,
        keeper ? 35 : 0,
        keeper ? 55 : 100,
        70 + ((index * 7) % 18),
      ),
      reaction: clampNumber(
        raw?.reaction,
        keeper ? 65 : 0,
        keeper ? 85 : 100,
        68 + ((index * 11) % 20),
      ),
      mistake: clampNumber(
        raw?.mistake,
        keeper ? 0.08 : 0,
        keeper ? 0.18 : 1,
        0.1 + (index % 5) * 0.03,
      ),
    };
  }

  return player;
}

function normalizeRoleName(value, fallback) {
  const normalized = String(value ?? fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);

  if (!normalized || normalized === "GK") {
    return fallback;
  }

  return normalized;
}

function playerBounds(team, keeper) {
  if (keeper) {
    return team === "home"
      ? { minX: 3, maxX: 10, minY: 40, maxY: 60 }
      : { minX: 94, maxX: 98, minY: 40, maxY: 60 };
  }

  return team === "home"
    ? { minX: 12, maxX: 90, minY: 10, maxY: 90 }
    : { minX: 42, maxX: 92, minY: 10, maxY: 90 };
}

function chooseBallCarrierId(rawBallCarrierId, players) {
  const requested = players.find(
    (player) =>
      player.team === "home" &&
      player.id === rawBallCarrierId &&
      !isGoalkeeper(player),
  );
  if (requested) {
    return requested.id;
  }

  const preferred = players
    .filter((player) => player.team === "home" && !isGoalkeeper(player))
    .sort((left, right) => Math.abs(left.x - 45) - Math.abs(right.x - 45))[0];

  return preferred?.id ?? "h1";
}

function spreadPlayers(players) {
  const spaced = players.map((player) => ({ ...player }));
  const minimumDistance = 7.2;

  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;

    for (let leftIndex = 0; leftIndex < spaced.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < spaced.length;
        rightIndex += 1
      ) {
        const left = spaced[leftIndex];
        const right = spaced[rightIndex];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= minimumDistance) {
          continue;
        }

        const leftSlot = shapeSlot(left);
        const rightSlot = shapeSlot(right);
        const overlap = (minimumDistance - Math.max(distance, 0.1)) / 2;
        const direction =
          distance < 0.1
            ? fallbackSeparationVector(left, right)
            : { x: dx / distance, y: dy / distance };

        left.x = clampNumber(
          left.x - direction.x * overlap,
          leftSlot.minX,
          leftSlot.maxX,
          left.x,
        );
        left.y = clampNumber(
          left.y - direction.y * overlap,
          leftSlot.minY,
          leftSlot.maxY,
          left.y,
        );
        right.x = clampNumber(
          right.x + direction.x * overlap,
          rightSlot.minX,
          rightSlot.maxX,
          right.x,
        );
        right.y = clampNumber(
          right.y + direction.y * overlap,
          rightSlot.minY,
          rightSlot.maxY,
          right.y,
        );
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return spaced.map((player) => ({
    ...player,
    x: roundCoordinate(player.x),
    y: roundCoordinate(player.y),
  }));
}

function shapeSlot(player) {
  return playerBounds(player.team, isGoalkeeper(player));
}

function fallbackSeparationVector(left, right) {
  if (left.team !== right.team) {
    return left.team === "home" ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }

  return left.y <= right.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

function roundCoordinate(value) {
  return Math.round(value * 10) / 10;
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
  return (
    id.includes("gk") ||
    name === "gk" ||
    name.includes("keeper") ||
    name.includes("goalkeeper")
  );
}

async function generateWithModel(previousLevel, solution) {
  const prompt = `Return only JSON for a football puzzle named Rotations.
Blue has the ball and attacks left-to-right. Generate a compact tactical spec; do not return coordinates or players.

Schema:
{
  "id": "short-slug",
  "title": "short title",
  "difficulty": number,
  "brief": "problem only, no solution hint",
  "homeFormation": "3-2-5",
  "awayFormation": "5-4-1",
  "ballCarrierRole": "RCM",
  "attackingFocus": "right_half_space",
  "defensiveBlock": "compact_mid_block",
  "compactness": 0.45,
  "lineHeight": "mid",
  "pressureSide": "right",
  "asymmetry": "left",
  "homeTweaks": {"RW":"wide_high","RCM":"half_space"},
  "awayTweaks": {"LB":"narrow","LCB":"cover_channel"},
  "defenderProfile": "balanced"
}

Allowed formations: 4-3-3, 4-2-3-1, 4-4-2, 3-4-3, 3-5-2, 5-3-2, 5-4-1, 3-2-5.
Allowed tweaks: wide_high, wide_deep, half_space, between_lines, between_cbs, narrow, cover_channel, press_ball, screen_pivot, hold_line.
Optional shape fields: compactness 0.15-0.75, lineHeight deep|mid|high, pressureSide left|right|central, asymmetry left|right|none.

Rules:
- Brief must describe the defensive problem only. Do not say what to use, where to pass, who should move, or how to solve it.
- Make the puzzle require at least one meaningful player movement, decoy, lob, switch, third-man action, or non-obvious timing choice.
- Avoid simple "pass to striker" setups.
- Pick a plausible non-GK Blue ballCarrierRole from the home formation.
- Make the next level harder through compactness, cover shadows, defender quality, or awkward starting access.

Previous level:
${JSON.stringify(previousLevel ?? null)}

Previous solution:
${JSON.stringify(solution ?? null)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const started = Date.now();
    const result = await generateJsonWithOpenRouter(
      prompt,
      0.8,
      controller.signal,
      (json) => normalizeLevel(json, previousLevel),
    );
    return {
      level: result.json,
      model: result.model,
      modelName: result.modelName,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateJsonWithOpenRouter(
  prompt,
  temperature,
  signal,
  transformJson,
) {
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch(openRouterUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL ?? "http://localhost:5173",
      "X-Title": "Rotations",
    },
    body: JSON.stringify({
      model: openRouterModel,
      provider: {
        sort: openRouterProviderSort,
      },
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature,
    }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `${openRouterModel}: OpenRouter responded ${response.status}: ${message.slice(0, 200)}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      `${openRouterModel}: OpenRouter returned no message content`,
    );
  }

  const parsed = JSON.parse(content);
  return {
    json: transformJson ? transformJson(parsed) : parsed,
    model: openRouterModel,
    modelName: openRouterModelName,
  };
}

function levelBufferKey(previousLevel, solution) {
  if (!previousLevel && !solution) {
    return "initial";
  }

  return JSON.stringify({
    previousLevelId: previousLevel?.id ?? null,
    previousDifficulty: previousLevel?.difficulty ?? null,
    previousBallCarrierId: previousLevel?.ballCarrierId ?? null,
    solution: solution ?? null,
  });
}

function getLevelBuffer(key, previousLevel, solution) {
  let buffer = levelBuffers.get(key);
  if (!buffer) {
    buffer = {
      key,
      previousLevel,
      solution,
      ready: [],
      readyFingerprints: new Set(),
      pending: new Set(),
      errors: [],
    };
    levelBuffers.set(key, buffer);
  }

  return buffer;
}

function startLevelGeneration(buffer) {
  const job = generateWithModel(buffer.previousLevel, buffer.solution)
    .then((result) => {
      const fingerprint = levelFingerprint(result.level);
      if (
        servedLevelFingerprints.has(fingerprint) ||
        buffer.readyFingerprints.has(fingerprint)
      ) {
        throw new Error("Generated level duplicated an already played or queued level");
      }

      buffer.ready.push(result);
      buffer.readyFingerprints.add(fingerprint);
      return result;
    })
    .catch((error) => {
      buffer.errors.push(error);
      throw error;
    })
    .finally(() => {
      buffer.pending.delete(job);
      fillLevelBuffer(buffer);
    });

  buffer.pending.add(job);
  job.catch(() => undefined);
  return job;
}

function fillLevelBuffer(buffer) {
  while (buffer.ready.length + buffer.pending.size < levelBufferTargetSize) {
    startLevelGeneration(buffer);
  }
}

async function getBufferedLevel(previousLevel, solution) {
  const key = levelBufferKey(previousLevel, solution);
  const buffer = getLevelBuffer(key, previousLevel, solution);

  if (buffer.ready.length > 0) {
    const next = buffer.ready.shift();
    buffer.readyFingerprints.delete(levelFingerprint(next.level));
    rememberServedLevel(next.level);
    fillLevelBuffer(buffer);
    return { ...next, buffered: true };
  }

  fillLevelBuffer(buffer);

  let completedLevel;
  try {
    completedLevel = await Promise.any([...buffer.pending]);
  } catch {
    const errors = buffer.errors.splice(0);
    throw new Error(
      errors
        .map((error) =>
          error instanceof Error ? error.message : String(error),
        )
        .join(" | ") || "All buffered level generations failed",
    );
  }

  const next = buffer.ready.shift() ?? completedLevel;
  if (!next) {
    throw new Error("Buffered level generation completed without a level");
  }

  buffer.readyFingerprints.delete(levelFingerprint(next.level));
  rememberServedLevel(next.level);
  fillLevelBuffer(buffer);
  return { ...next, buffered: false };
}

app.get("/api/health", (_request, response) => {
  const initialBuffer = levelBuffers.get("initial");
  response.json({
    ok: true,
    provider: "openrouter",
    model: openRouterModel,
    modelName: openRouterModelName,
    providerSort: openRouterProviderSort,
    openRouterUrl,
    configured: Boolean(openRouterApiKey),
    levelBuffer: initialBuffer
      ? {
          target: levelBufferTargetSize,
          ready: initialBuffer.ready.length,
          pending: initialBuffer.pending.size,
          served: servedLevelFingerprints.size,
        }
      : {
          target: levelBufferTargetSize,
          ready: 0,
          pending: 0,
          served: servedLevelFingerprints.size,
        },
  });
});

app.post("/api/levels", async (request, response) => {
  const { previousLevel, solution } = request.body ?? {};

  try {
    const result = await getBufferedLevel(previousLevel, solution);
    response.json({
      level: result.level,
      source: "openrouter",
      model: result.model,
      modelName: result.modelName,
      durationMs: result.buffered ? undefined : result.durationMs,
      buffered: result.buffered,
    });
  } catch (error) {
    fillLevelBuffer(
      getLevelBuffer(
        levelBufferKey(previousLevel, solution),
        previousLevel,
        solution,
      ),
    );
    response.json({
      level: fallbackLevel(previousLevel),
      source: "fallback",
      model: openRouterModel,
      modelName: openRouterModelName,
      warning:
        error instanceof Error ? error.message : "OpenRouter unavailable",
    });
  }
});

export function startLevelBuffer() {
  if (levelBufferStarted) {
    return;
  }

  levelBufferStarted = true;
  const initialBuffer = getLevelBuffer("initial");
  fillLevelBuffer(initialBuffer);
}

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Rotations API listening on http://localhost:${port}`);
    startLevelBuffer();
  });
}
