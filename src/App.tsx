import {
  CircleDot,
  MoveRight,
  Play,
  RotateCcw,
  StepBack,
  Target,
} from "lucide-react";
import { MouseEvent, useMemo, useRef, useState } from "react";

type Team = "home" | "away";

type Point = {
  x: number;
  y: number;
};

type Player = Point & {
  id: string;
  name: string;
  team: Team;
  speed?: number;
  reaction?: number;
  mistake?: number;
};

type Level = {
  id: string;
  title: string;
  difficulty: number;
  brief: string;
  attackingTeam: string;
  defendingTeam: string;
  ballCarrierId: string;
  players: Player[];
};

type MoveStep = {
  type: "move";
  playerId: string;
  from: Point;
  to: Point;
};

type PassStep = {
  type: "pass";
  fromPlayerId: string;
  toPlayerId: string;
  from: Point;
  to: Point;
};

type ShotStep = {
  type: "shot";
  fromPlayerId: string;
  from: Point;
  to: Point;
};

type Step = MoveStep | PassStep | ShotStep;

type LevelResponse = {
  level: Level;
  source: "ollama" | "fallback";
  model: string;
  warning?: string;
};

type PendingAction =
  | { type: "move"; playerId: string }
  | { type: "pass"; fromPlayerId: string };

const goalPoint = { x: 98, y: 50 };

function App() {
  const [level, setLevel] = useState<Level | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [ballCarrierId, setBallCarrierId] = useState("");
  const [sequence, setSequence] = useState<Step[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [playbackPlayers, setPlaybackPlayers] = useState<Player[] | null>(null);
  const [playbackBall, setPlaybackBall] = useState<Point | null>(null);
  const [activeStep, setActiveStep] = useState<Step | null>(null);
  const [result, setResult] = useState<{
    scored: boolean;
    reason: string;
  } | null>(null);
  const [loadingLevel, setLoadingLevel] = useState(false);
  const [activeDefenderId, setActiveDefenderId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const visiblePlayers = playbackPlayers ?? players;
  const ballCarrier = visiblePlayers.find(
    (player) => player.id === ballCarrierId,
  );
  const ballPosition = playbackBall ?? ballCarrier ?? null;
  const activeDefender = visiblePlayers.find(
    (player) => player.id === activeDefenderId && player.team === "away",
  );
  const canRecord = Boolean(level) && !playbackPlayers;

  const arrows = useMemo(
    () =>
      sequence.filter(
        (step) => step.type === "pass" || step.type === "shot",
      ) as Array<PassStep | ShotStep>,
    [sequence],
  );
  const movementArrows = useMemo(
    () => sequence.filter((step): step is MoveStep => step.type === "move"),
    [sequence],
  );

  async function loadLevel(previousLevel?: Level, solution?: Step[]) {
    setLoadingLevel(true);
    setResult(null);
    setSelectedPlayerId(null);
    setActiveDefenderId(null);
    setPendingAction(null);

    try {
      const response = await fetch("/api/levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousLevel, solution }),
      });
      const data = (await response.json()) as LevelResponse;
      const nextLevel = withDefenderRatings(data.level);
      setLevel(nextLevel);
      setPlayers(nextLevel.players);
      setBallCarrierId(nextLevel.ballCarrierId);
      setSequence([]);
    } finally {
      setLoadingLevel(false);
    }
  }

  function rebuildFromSequence(nextSequence: Step[], clearResult = true) {
    if (!level) {
      return;
    }

    const rebuiltPlayers = level.players.map((player) => ({ ...player }));
    let rebuiltBallCarrier = level.ballCarrierId;

    for (const step of nextSequence) {
      if (step.type === "move") {
        const player = rebuiltPlayers.find(
          (candidate) => candidate.id === step.playerId,
        );
        if (player) {
          player.x = step.to.x;
          player.y = step.to.y;
        }
      }
      if (step.type === "pass") {
        rebuiltBallCarrier = step.toPlayerId;
      }
    }

    setPlayers(rebuiltPlayers);
    setBallCarrierId(rebuiltBallCarrier);
    setSequence(nextSequence);
    if (clearResult) {
      setResult(null);
    }
  }

  function undoStep() {
    rebuildFromSequence(sequence.slice(0, -1));
  }

  function restartSequence() {
    rebuildFromSequence([]);
    setSelectedPlayerId(null);
    setActiveDefenderId(null);
    setPendingAction(null);
  }

  function getClientPoint(clientX: number, clientY: number): Point {
    const bounds = svgRef.current!.getBoundingClientRect();
    return {
      x: clamp(((clientX - bounds.left) / bounds.width) * 100, 2, 98),
      y: clamp(((clientY - bounds.top) / bounds.height) * 100, 5, 95),
    };
  }

  function handlePitchClick(event: MouseEvent<SVGSVGElement>) {
    if (
      pendingAction?.type !== "move" ||
      !canRecord ||
      (event.target as Element).closest(".player-group, .ball, .goal-zone")
    ) {
      return;
    }

    addMovement(
      pendingAction.playerId,
      getClientPoint(event.clientX, event.clientY),
    );
  }

  function addMovement(playerId: string, destination: Point) {
    const runner = players.find(
      (player) => player.id === playerId && player.team === "home",
    );
    if (!runner) {
      return;
    }

    const from = { x: runner.x, y: runner.y };
    const distance = Math.hypot(destination.x - from.x, destination.y - from.y);
    if (distance <= 1.5) {
      return;
    }

    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId ? { ...player, ...destination } : player,
      ),
    );
    setSequence((current) => [
      ...current,
      { type: "move", playerId, from, to: destination },
    ]);
    setSelectedPlayerId(playerId);
    setPendingAction({ type: "move", playerId });
    setResult(null);
  }

  function choosePlayer(player: Player) {
    if (!canRecord) {
      return;
    }

    setResult(null);

    if (player.team === "away") {
      if (pendingAction?.type === "pass" && isGoalkeeper(player)) {
        addShot();
        return;
      }

      setActiveDefenderId((current) =>
        current === player.id ? null : player.id,
      );
      return;
    }

    setActiveDefenderId(null);
    if (pendingAction?.type === "pass") {
      addPass(pendingAction.fromPlayerId, player.id);
      return;
    }

    setSelectedPlayerId(player.id);
    setPendingAction({ type: "move", playerId: player.id });
  }

  function addPass(fromPlayerId: string, toPlayerId: string) {
    if (fromPlayerId === toPlayerId) {
      return;
    }

    const passer = players.find((candidate) => candidate.id === fromPlayerId);
    const receiver = players.find(
      (candidate) => candidate.id === toPlayerId && candidate.team === "home",
    );
    if (!passer || !receiver) {
      return;
    }

    setSequence((current) => [
      ...current,
      {
        type: "pass",
        fromPlayerId: passer.id,
        toPlayerId: receiver.id,
        from: { x: passer.x, y: passer.y },
        to: { x: receiver.x, y: receiver.y },
      },
    ]);
    setBallCarrierId(receiver.id);
    setSelectedPlayerId(receiver.id);
    setPendingAction(null);
  }

  function beginPass() {
    if (!canRecord || !ballCarrier) {
      return;
    }

    setSelectedPlayerId(ballCarrier.id);
    setPendingAction({ type: "pass", fromPlayerId: ballCarrier.id });
    setActiveDefenderId(null);
    setResult(null);
  }

  function addShot() {
    if (pendingAction?.type !== "pass") {
      return;
    }

    const shooter = players.find(
      (player) => player.id === pendingAction.fromPlayerId,
    );
    if (!shooter) {
      return;
    }

    setSequence((current) => [
      ...current,
      {
        type: "shot",
        fromPlayerId: shooter.id,
        from: { x: shooter.x, y: shooter.y },
        to: goalPoint,
      },
    ]);
    setSelectedPlayerId(null);
    setPendingAction(null);
    setResult(null);
  }

  async function playSequence() {
    if (!level || sequence.length === 0 || playbackPlayers) {
      return;
    }

    setSelectedPlayerId(null);
    setPendingAction(null);
    setActiveDefenderId(null);
    setResult(null);

    let animatedPlayers = level.players.map((player) => ({ ...player }));
    let animatedBallCarrier = level.ballCarrierId;
    setPlaybackPlayers(animatedPlayers);
    setBallCarrierId(animatedBallCarrier);
    setPlaybackBall(null);

    for (const step of sequence) {
      setActiveStep(step);

      if (step.type === "move") {
        await animate((progress) => {
          setPlaybackPlayers(
            animatedPlayers.map((player) =>
              player.id === step.playerId
                ? {
                    ...player,
                    x: lerp(step.from.x, step.to.x, progress),
                    y: lerp(step.from.y, step.to.y, progress),
                  }
                : player,
            ),
          );
        });
        animatedPlayers = animatedPlayers.map((player) =>
          player.id === step.playerId
            ? { ...player, x: step.to.x, y: step.to.y }
            : player,
        );
        setPlaybackPlayers(animatedPlayers);
      }

      if (step.type === "pass") {
        await animate((progress) => {
          setPlaybackBall({
            x: lerp(step.from.x, step.to.x, progress),
            y: lerp(step.from.y, step.to.y, progress),
          });
        }, 560);
        animatedBallCarrier = step.toPlayerId;
        setBallCarrierId(animatedBallCarrier);
        setPlaybackBall(null);
      }

      if (step.type === "shot") {
        await animate((progress) => {
          setPlaybackBall({
            x: lerp(step.from.x, step.to.x, progress),
            y: lerp(step.from.y, step.to.y, progress),
          });
        }, 700);
      }
    }

    setActiveStep(null);
    const evaluation = evaluateSequence(sequence, animatedPlayers);
    setResult(evaluation);
    setPlaybackPlayers(null);
    setPlaybackBall(null);
    rebuildFromSequence(sequence, false);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Rotations</p>
          <h1>{level ? level.title : "Build a scoring rotation"}</h1>
          <p className="brief">
            {level
              ? level.brief
              : "Generate a local level, record player movement and passes, then play the sequence out."}
          </p>
        </div>
        <button
          className="primary-action"
          onClick={() => loadLevel()}
          disabled={loadingLevel || Boolean(playbackPlayers)}
        >
          <CircleDot size={18} />
          {loadingLevel ? "Generating" : level ? "New Level" : "Generate Level"}
        </button>
      </section>

      <section className="game-layout">
        <div className="pitch-wrap">
          <svg
            ref={svgRef}
            viewBox="0 0 100 100"
            className={`pitch ${pendingAction ? `${pendingAction.type}-pending` : ""}`}
            role="img"
            aria-label="Football puzzle pitch"
            onClick={handlePitchClick}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="7"
                markerHeight="7"
                refX="5"
                refY="3.5"
                orient="auto"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
              </marker>
            </defs>

            <rect
              x="1"
              y="4"
              width="98"
              height="92"
              rx="2"
              className="field-line"
            />
            <line x1="50" x2="50" y1="4" y2="96" className="field-line" />
            <circle cx="50" cy="50" r="10" className="field-line fill-none" />
            <rect
              x="1"
              y="30"
              width="15"
              height="40"
              className="field-line fill-none"
            />
            <rect
              x="84"
              y="30"
              width="15"
              height="40"
              className="field-line fill-none"
            />
            <rect
              x="97"
              y="40"
              width="3"
              height="20"
              className="goal-zone"
              onClick={(event) => {
                event.stopPropagation();
                addShot();
              }}
            />

            {movementArrows.map((arrow, index) => (
              <line
                key={`move-${index}`}
                x1={arrow.from.x}
                y1={arrow.from.y}
                x2={arrow.to.x}
                y2={arrow.to.y}
                className="movement-arrow"
                markerEnd="url(#arrowhead)"
              />
            ))}

            {arrows.map((arrow, index) => (
              <line
                key={`${arrow.type}-${index}`}
                x1={arrow.from.x}
                y1={arrow.from.y}
                x2={arrow.to.x}
                y2={arrow.to.y}
                className={`sequence-arrow ${arrow.type === "shot" ? "shot-arrow" : ""}`}
                markerEnd="url(#arrowhead)"
              />
            ))}

            {activeStep &&
            (activeStep.type === "pass" || activeStep.type === "shot") ? (
              <line
                x1={activeStep.from.x}
                y1={activeStep.from.y}
                x2={activeStep.to.x}
                y2={activeStep.to.y}
                className="active-arrow"
                markerEnd="url(#arrowhead)"
              />
            ) : null}

            {activeStep?.type === "move" ? (
              <line
                x1={activeStep.from.x}
                y1={activeStep.from.y}
                x2={activeStep.to.x}
                y2={activeStep.to.y}
                className="active-movement-arrow"
                markerEnd="url(#arrowhead)"
              />
            ) : null}

            {visiblePlayers.map((player) => (
              <g
                key={player.id}
                className={`player-group ${player.team} ${selectedPlayerId === player.id ? "selected" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  choosePlayer(player);
                }}
              >
                <circle
                  cx={player.x}
                  cy={player.y}
                  r="3.2"
                  className="player-ring"
                />
                <text
                  x={player.x}
                  y={player.y + 1.1}
                  textAnchor="middle"
                  className="player-label"
                >
                  {player.name}
                </text>
              </g>
            ))}

            {ballPosition ? (
              <circle
                cx={ballPosition.x + 2.9}
                cy={ballPosition.y - 3.2}
                r="1.25"
                className="ball"
                onClick={(event) => {
                  event.stopPropagation();
                  beginPass();
                }}
              />
            ) : null}
          </svg>

          {activeDefender ? <DefenderCard player={activeDefender} /> : null}
          {result ? (
            <div className={`result-overlay ${result.scored ? "scored" : "missed"}`}>
              <strong>{result.scored ? "Goal scored" : "Chance missed"}</strong>
              <p>{result.reason}</p>
              <div className="result-actions">
                <button
                  onClick={() => {
                    restartSequence();
                    setResult(null);
                  }}
                >
                  <RotateCcw size={18} />
                  Restart
                </button>
                {level ? (
                  <button
                    className="primary-action"
                    onClick={() => loadLevel(level, sequence)}
                    disabled={loadingLevel}
                  >
                    <CircleDot size={18} />
                    Next Level
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="side-panel">
          <div className="meta-row">
            <span>Difficulty {level?.difficulty ?? "-"}</span>
          </div>

          <div className="controls">
            <button
              onClick={undoStep}
              disabled={!canRecord || sequence.length === 0}
            >
              <StepBack size={18} />
              Undo
            </button>
            <button
              onClick={restartSequence}
              disabled={!canRecord || sequence.length === 0}
            >
              <RotateCcw size={18} />
              Restart
            </button>
            <button
              className="primary-action"
              onClick={playSequence}
              disabled={
                !level || sequence.length === 0 || Boolean(playbackPlayers)
              }
            >
              <Play size={18} />
              Confirm
            </button>
          </div>

          <div className="instruction-box">
            <strong>{instructionTitle(pendingAction)}</strong>
            <p>
              {instructionText(pendingAction)}
            </p>
          </div>

          <ol className="sequence-list">
            {sequence.length === 0 ? <li>No steps recorded yet.</li> : null}
            {sequence.map((step, index) => (
              <li
                key={`${step.type}-${index}`}
                className={`sequence-step ${step.type}`}
              >
                <span>{index + 1}</span>
                <StepIcon type={step.type} />
                {describeStep(step, players)}
              </li>
            ))}
          </ol>

        </aside>
      </section>
    </main>
  );
}

function describeStep(step: Step, players: Player[]) {
  if (step.type === "move") {
    return `${nameFor(step.playerId, players)} runs into position`;
  }
  if (step.type === "pass") {
    return `${nameFor(step.fromPlayerId, players)} passes to ${nameFor(step.toPlayerId, players)}`;
  }
  return `${nameFor(step.fromPlayerId, players)} shoots`;
}

function instructionTitle(pendingAction: PendingAction | null) {
  if (pendingAction?.type === "move") {
    return "Choose run destination";
  }
  if (pendingAction?.type === "pass") {
    return "Choose pass or shot";
  }
  return "Build the rotation";
}

function instructionText(pendingAction: PendingAction | null) {
  if (pendingAction?.type === "move") {
    return "Click a spot on the pitch to move the selected player there. That run is added as the next timeline step.";
  }
  if (pendingAction?.type === "pass") {
    return "Click a blue teammate to pass, or click the goal to shoot. The action is added next in the timeline.";
  }
  return "Click a blue player to start a movement, or click the ball to start a pass. The order you click creates the timeline.";
}

function StepIcon({ type }: { type: Step["type"] }) {
  if (type === "move") {
    return <MoveRight size={16} aria-hidden="true" />;
  }
  if (type === "shot") {
    return <Target size={16} aria-hidden="true" />;
  }
  return <CircleDot size={16} aria-hidden="true" />;
}

function withDefenderRatings(level: Level): Level {
  const players = [...level.players];
  if (!players.some((player) => player.team === "away" && isGoalkeeper(player))) {
    players.push({
      id: "a0",
      name: "GK",
      team: "away",
      x: 96,
      y: 50,
      speed: 54,
      reaction: 90,
      mistake: 0.06,
    });
  }

  return {
    ...level,
    players: players.map((player, index) => {
      if (player.team !== "away") {
        return player;
      }

      return {
        ...player,
        speed: clamp(player.speed ?? 62 + ((index * 11) % 31), 0, 100),
        reaction: clamp(player.reaction ?? 60 + ((index * 13) % 33), 0, 100),
        mistake: clamp(player.mistake ?? 0.08 + (index % 5) * 0.04, 0, 1),
      };
    }),
  };
}

function isGoalkeeper(player: Player) {
  const id = player.id.toLowerCase();
  const name = player.name.toLowerCase();
  return (
    id.includes("gk") ||
    name === "gk" ||
    name.includes("keeper") ||
    name.includes("goalkeeper")
  );
}

function nameFor(id: string, players: Player[]) {
  return players.find((player) => player.id === id)?.name ?? id;
}

function evaluateSequence(sequence: Step[], players: Player[]) {
  const finalShot = [...sequence]
    .reverse()
    .find((step): step is ShotStep => step.type === "shot");
  if (!finalShot) {
    const finalCarrierStep = [...sequence]
      .reverse()
      .find((step): step is PassStep => step.type === "pass");
    const carrier = players.find(
      (player) => player.id === finalCarrierStep?.toPlayerId,
    );
    if (carrier && carrier.x > 88 && carrier.y > 37 && carrier.y < 63) {
      return {
        scored: true,
        reason: "The receiver arrived in the goal mouth with a clean finish.",
      };
    }
    return {
      scored: false,
      reason:
        "The sequence created movement, but it never ended with a shot or goal-mouth arrival.",
    };
  }

  if (finalShot.from.x < 70) {
    return {
      scored: false,
      reason: "The shot came from too far out for this puzzle.",
    };
  }

  if (finalShot.from.y < 18 || finalShot.from.y > 82) {
    return { scored: false, reason: "The shooting angle was too narrow." };
  }

  const blockers = players
    .filter((player) => {
      if (
        player.team !== "away" ||
        player.x <= finalShot.from.x ||
        player.x >= 97
      ) {
        return false;
      }

      return (
        distanceToSegment(player, finalShot.from, finalShot.to) <
        blockRadius(player)
      );
    })
    .sort((a, b) => defenderComposite(b) - defenderComposite(a));

  if (blockers.length > 0) {
    const blocker = blockers[0];
    return {
      scored: false,
      reason: `${blocker.name} blocked the shooting lane with a ${Math.round(defenderComposite(blocker))} defensive score.`,
    };
  }

  return {
    scored: true,
    reason:
      "The final shot reached the goal before the defense could cover the lane.",
  };
}

function DefenderCard({ player }: { player: Player }) {
  const speed = Math.round(player.speed ?? 0);
  const reaction = Math.round(player.reaction ?? 0);
  const mistake = player.mistake ?? 0;
  const overall = defenderComposite(player);

  return (
    <div
      className="defender-card"
      style={{
        left: `${clamp(player.x, 16, 84)}%`,
        top: `${clamp(player.y, 18, 82)}%`,
      }}
    >
      <div className="defender-card-header">
        <span>{player.name}</span>
        <strong>{overall.toFixed(1)}</strong>
      </div>
      <StatRow label="Speed" value={speed} max={100} />
      <StatRow label="Reaction" value={reaction} max={100} />
      <StatRow
        label="Mistake"
        value={Math.round(mistake * 100)}
        max={100}
        suffix="%"
        inverted
      />
    </div>
  );
}

function StatRow({
  label,
  value,
  max,
  suffix = "",
  inverted = false,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  inverted?: boolean;
}) {
  const percent = clamp((value / max) * 100, 0, 100);

  return (
    <div className="stat-row">
      <div>
        <span>{label}</span>
        <strong>
          {value}
          {suffix}
        </strong>
      </div>
      <div className="stat-track">
        <span
          className={inverted ? "mistake-fill" : ""}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function defenderComposite(player: Player) {
  const speed = clamp(player.speed ?? 0, 0, 100);
  const reaction = clamp(player.reaction ?? 0, 0, 100);
  const mistake = clamp(player.mistake ?? 0, 0, 1);
  return ((speed + reaction) / 2) * (1 - mistake);
}

function blockRadius(player: Player) {
  return 2.6 + (defenderComposite(player) / 100) * 5.2;
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const progress = clamp(
    ((point.x - start.x) * (end.x - start.x) +
      (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1,
  );
  const projection = {
    x: start.x + progress * (end.x - start.x),
    y: start.y + progress * (end.y - start.y),
  };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function animate(update: (progress: number) => void, duration = 650) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const rawProgress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - (1 - rawProgress) ** 3;
      update(eased);
      if (rawProgress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default App;
