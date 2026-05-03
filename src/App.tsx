import {
  CircleDot,
  Copy,
  MessageCircle,
  MoveRight,
  Play,
  RotateCcw,
  Send,
  Share2,
  StepBack,
  Target,
} from "lucide-react";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";

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
  kind?: "ground" | "lofted";
};

type ShotStep = {
  type: "shot";
  fromPlayerId: string;
  from: Point;
  to: Point;
};

type Step = MoveStep | PassStep | ShotStep;

type ActiveRun = {
  playerId: string;
  from: Point;
  to: Point;
  startTime: number;
  duration: number;
};

type RunTackle = {
  runnerId: string;
  defender: Player;
  point: Point;
  time: number;
};

type LevelResponse = {
  level: Level;
  source: "openrouter" | "fallback";
  model: string;
  modelName?: string;
  durationMs?: number;
  buffered?: boolean;
  warning?: string;
};

type PendingAction =
  | { type: "move"; playerId: string }
  | { type: "pass"; fromPlayerId: string };

const goalPoint = { x: 98, y: 50 };
const movementStartDelay = 0.28;
const groundPassSpeed = 70;
const loftedPassSpeed = 43;
const shotSpeed = 82;
const playerRunSpeed = 21;
const receiveControlRadius = 3.8;
const shareUrl = "https://playrotations.com";

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
  const [generationStatus, setGenerationStatus] = useState("");
  const [loadingLevel, setLoadingLevel] = useState(false);
  const [activeDefenderId, setActiveDefenderId] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const solvedLevelIds = useRef<Set<string>>(new Set());

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
      sequence
        .map((step, index) => ({ step, index }))
        .filter(
          (entry): entry is { step: PassStep | ShotStep; index: number } =>
            entry.step.type === "pass" || entry.step.type === "shot",
        ),
    [sequence],
  );
  const movementArrows = useMemo(
    () => sequence.filter((step): step is MoveStep => step.type === "move"),
    [sequence],
  );

  useEffect(() => {
    void loadLevel();
  }, []);

  async function loadLevel(previousLevel?: Level, solution?: Step[]) {
    setLoadingLevel(true);
    setResult(null);
    setShareOpen(false);
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
      setGenerationStatus(generationStatusText(data));
    } finally {
      setLoadingLevel(false);
    }
  }

  function startNewGame() {
    setScore(0);
    solvedLevelIds.current.clear();
    void loadLevel();
  }

  function shareText() {
    return `I got through ${score} defences. ${shareUrl}`;
  }

  async function copyShareText() {
    await navigator.clipboard?.writeText(shareText());
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
        const receiver = rebuiltPlayers.find(
          (candidate) => candidate.id === step.toPlayerId,
        );
        if (receiver && step.kind === "lofted") {
          receiver.x = step.to.x;
          receiver.y = step.to.y;
        }
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
    setShareOpen(false);
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
    if (
      pendingAction?.type === "move" &&
      pendingAction.playerId === player.id
    ) {
      setSelectedPlayerId(null);
      setPendingAction(null);
      return;
    }

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
        kind: "ground",
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

    if (pendingAction?.type === "pass") {
      setPendingAction(null);
      setSelectedPlayerId(null);
      return;
    }

    setSelectedPlayerId(null);
    setPendingAction({ type: "pass", fromPlayerId: ballCarrier.id });
    setActiveDefenderId(null);
    setResult(null);
    setShareOpen(false);
  }

  function toggleLoftedPass(stepIndex: number) {
    setSequence((current) =>
      current.map((step, index) => {
        if (index !== stepIndex || step.type !== "pass") {
          return step;
        }
        return {
          ...step,
          kind: step.kind === "lofted" ? "ground" : "lofted",
        };
      }),
    );
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
    let timelineTime = 0;
    const activeRuns: ActiveRun[] = [];
    const executedSequence: Step[] = [];
    setPlaybackPlayers(animatedPlayers);
    setBallCarrierId(animatedBallCarrier);
    setPlaybackBall(null);

    const stopForTackle = async (tackle: RunTackle, fromTime: number) => {
      await animate((progress) => {
        const displayTime = lerp(fromTime, tackle.time, progress);
        setPlaybackPlayers(playersAtTime(animatedPlayers, activeRuns, displayTime));
      }, secondsToMs(Math.max(tackle.time - fromTime, 0.2)));
      const runnerName = nameFor(tackle.runnerId, animatedPlayers);
          setActiveStep(null);
          setShareOpen(false);
          setResult({
            scored: false,
            reason: `${tackle.defender.name} stepped in and stopped ${runnerName}'s run with a ${Math.round(defenderComposite(tackle.defender))} defensive score.`,
      });
      setPlaybackPlayers(null);
      setPlaybackBall(null);
      rebuildFromSequence(sequence, false);
    };

    for (let stepIndex = 0; stepIndex < sequence.length; stepIndex += 1) {
      const step = sequence[stepIndex];
      setActiveStep(step);

      if (step.type === "move") {
        const currentPlayerPosition = playerPositionAt(
          step.playerId,
          animatedPlayers,
          activeRuns,
          timelineTime,
        );
        const run = {
          playerId: step.playerId,
          from: currentPlayerPosition,
          to: step.to,
          startTime: timelineTime,
          duration: movementDuration(currentPlayerPosition, step.to),
        };
        activeRuns.push(run);
        executedSequence.push({ ...step, from: currentPlayerPosition });

        const movementEndTime = timelineTime + movementStartDelay;
        const movementTackle = findRunTackle(
          activeRuns,
          animatedPlayers,
          timelineTime,
          movementEndTime,
        );
        if (movementTackle) {
          await stopForTackle(movementTackle, timelineTime);
          return;
        }

        await animate((progress) => {
          const displayTime = lerp(
            timelineTime,
            movementEndTime,
            progress,
          );
          setPlaybackPlayers(playersAtTime(animatedPlayers, activeRuns, displayTime));
        }, secondsToMs(movementStartDelay));
        timelineTime = movementEndTime;
        animatedPlayers = playersAtTime(animatedPlayers, activeRuns, timelineTime);
        setPlaybackPlayers(animatedPlayers);
        settleCompletedRuns(activeRuns, timelineTime);
      }

      if (step.type === "pass") {
        const passStart = playerPositionAt(
          step.fromPlayerId,
          animatedPlayers,
          activeRuns,
          timelineTime,
        );
        const receiverArrival = playerPositionAt(
          step.toPlayerId,
          animatedPlayers,
          activeRuns,
          timelineTime + passDuration({ ...step, from: passStart }),
        );
        const receiverLateBy = distance(receiverArrival, step.to);

        const receiver = animatedPlayers.find(
          (player) => player.id === step.toPlayerId,
        );
        const timedStep = { ...step, from: passStart };
        const timedPassDuration = passDuration(timedStep);
        const passEndTime = timelineTime + timedPassDuration;
        const interception = findPassInterception(timedStep, animatedPlayers);
        const passTackle = findRunTackle(
          activeRuns,
          animatedPlayers,
          timelineTime,
          passEndTime,
        );
        const interceptionTime = interception
          ? timelineTime + timedPassDuration * interception.progress
          : Infinity;
        if (passTackle && passTackle.time <= interceptionTime) {
          await stopForTackle(passTackle, timelineTime);
          return;
        }

        if (interception) {
          await animate((progress) => {
            const displayTime = lerp(
              timelineTime,
              timelineTime + timedPassDuration * interception.progress,
              progress,
            );
            setPlaybackBall({
              x: lerp(passStart.x, interception.point.x, progress),
              y: lerp(passStart.y, interception.point.y, progress),
            });
            setPlaybackPlayers(playersAtTime(animatedPlayers, activeRuns, displayTime));
          }, 460);
          setActiveStep(null);
          setShareOpen(false);
          setResult({
            scored: false,
            reason: `${interception.player.name} intercepted the ${step.kind === "lofted" ? "lobbed " : ""}pass with a ${Math.round(defenderComposite(interception.player))} defensive score.`,
          });
          setPlaybackPlayers(null);
          setPlaybackBall(null);
          rebuildFromSequence(sequence, false);
          return;
        }

        await animate((progress) => {
          const displayTime = lerp(
            timelineTime,
            passEndTime,
            progress,
          );
          const nextBall = loftedPoint(passStart, step.to, progress, step.kind);
          setPlaybackBall({
            x: nextBall.x,
            y: nextBall.y,
          });
          setPlaybackPlayers(playersAtTime(animatedPlayers, activeRuns, displayTime));
        }, secondsToMs(timedPassDuration));
        timelineTime = passEndTime;
        animatedPlayers = playersAtTime(animatedPlayers, activeRuns, timelineTime);
        settleCompletedRuns(activeRuns, timelineTime);

        if (!receiver || receiverLateBy > receiveControlRadius) {
          setActiveStep(null);
          setShareOpen(false);
          setResult({
            scored: false,
            reason: `${nameFor(step.toPlayerId, animatedPlayers)} could not arrive in time for the ${step.kind === "lofted" ? "lobbed " : ""}pass.`,
          });
          setPlaybackPlayers(null);
          setPlaybackBall(null);
          rebuildFromSequence(sequence, false);
          return;
        }

        animatedPlayers = animatedPlayers.map((player) =>
          player.id === step.toPlayerId ? { ...player, x: step.to.x, y: step.to.y } : player,
        );
        executedSequence.push(timedStep);
        animatedBallCarrier = step.toPlayerId;
        setBallCarrierId(animatedBallCarrier);
        setPlaybackBall(null);
        setPlaybackPlayers(animatedPlayers);
      }

      if (step.type === "shot") {
        const shotStart = playerPositionAt(
          step.fromPlayerId,
          animatedPlayers,
          activeRuns,
          timelineTime,
        );
        const timedStep = { ...step, from: shotStart };
        const duration = distance(shotStart, step.to) / shotSpeed;
        await animate((progress) => {
          const displayTime = lerp(timelineTime, timelineTime + duration, progress);
          setPlaybackBall({
            x: lerp(shotStart.x, step.to.x, progress),
            y: lerp(shotStart.y, step.to.y, progress),
          });
          setPlaybackPlayers(playersAtTime(animatedPlayers, activeRuns, displayTime));
        }, secondsToMs(duration));
        timelineTime += duration;
        animatedPlayers = playersAtTime(animatedPlayers, activeRuns, timelineTime);
        settleCompletedRuns(activeRuns, timelineTime);
        executedSequence.push(timedStep);
        setActiveStep(timedStep);
      }
    }

    setActiveStep(null);
    const evaluation = evaluateSequence(executedSequence, animatedPlayers);
    if (evaluation.scored && level && !solvedLevelIds.current.has(level.id)) {
      solvedLevelIds.current.add(level.id);
      setScore((current) => current + 1);
    }
    setShareOpen(false);
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

            {arrows.map(({ step, index }) => (
              <g key={`${step.type}-${index}`}>
                <path
                  d={ballActionPath(step)}
                  className={`sequence-arrow ${step.type === "shot" ? "shot-arrow" : ""} ${step.type === "pass" && step.kind === "lofted" ? "lofted-arrow" : ""}`}
                  markerEnd="url(#arrowhead)"
                />
                {step.type === "pass" ? (
                  <path
                    d={ballActionPath(step)}
                    className="pass-hit"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLoftedPass(index);
                    }}
                  />
                ) : null}
              </g>
            ))}

            {activeStep &&
            (activeStep.type === "pass" || activeStep.type === "shot") ? (
              <path
                d={ballActionPath(activeStep)}
                className={`active-arrow ${activeStep.type === "pass" && activeStep.kind === "lofted" ? "lofted-arrow" : ""}`}
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
                className={`player-group ${player.team} ${pendingAction?.type !== "pass" && selectedPlayerId === player.id ? "selected" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  choosePlayer(player);
                }}
              >
                <circle
                  cx={player.x}
                  cy={player.y}
                  r="2.75"
                  className="player-ring"
                />
                <text
                  x={player.x}
                  y={player.y + 0.9}
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
                className={`ball ${pendingAction?.type === "pass" ? "selected" : ""}`}
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
              {!result.scored ? (
                <p className="score-line">Score: {score}</p>
              ) : null}
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
                {!result.scored ? (
                  <button
                    className="primary-action"
                    onClick={() => setShareOpen((current) => !current)}
                  >
                    <Share2 size={18} />
                    Share
                  </button>
                ) : null}
              </div>
              {!result.scored && shareOpen ? (
                <div className="share-actions">
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Send size={16} />
                    Twitter
                  </a>
                  <a href={`sms:?&body=${encodeURIComponent(shareText())}`}>
                    <MessageCircle size={16} />
                    Messages
                  </a>
                  <a
                    href={`fb-messenger://share?link=${encodeURIComponent(shareUrl)}`}
                  >
                    <MessageCircle size={16} />
                    Messenger
                  </a>
                  <button onClick={copyShareText}>
                    <Copy size={16} />
                    Copy
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {!result && shareOpen ? (
            <div className="result-overlay share-overlay">
              <strong>Score: {score}</strong>
              <p>{shareText()}</p>
              <div className="share-actions">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Send size={16} />
                  Twitter
                </a>
                <a href={`sms:?&body=${encodeURIComponent(shareText())}`}>
                  <MessageCircle size={16} />
                  Messages
                </a>
                <a
                  href={`fb-messenger://share?link=${encodeURIComponent(shareUrl)}`}
                >
                  <MessageCircle size={16} />
                  Messenger
                </a>
                <button onClick={copyShareText}>
                  <Copy size={16} />
                  Copy
                </button>
              </div>
              <button onClick={() => setShareOpen(false)}>Close</button>
            </div>
          ) : null}
        </div>

        <aside className="side-panel">
          <div className="generation-panel">
            <button
              className="primary-action"
              onClick={startNewGame}
              disabled={loadingLevel || Boolean(playbackPlayers)}
            >
              <CircleDot size={18} />
              {loadingLevel ? "Generating" : level ? "New Game" : "Generate Level"}
            </button>
            <p
              className="generation-status"
              title={loadingLevel ? "Generating level..." : generationStatus}
            >
              {loadingLevel ? "Generating level..." : generationStatus}
            </p>
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
              className="primary-action play-action"
              onClick={playSequence}
              disabled={
                !level || sequence.length === 0 || Boolean(playbackPlayers)
              }
            >
              <Play size={18} />
              Play
            </button>
            <button
              className="score-action"
              onClick={() => setShareOpen(true)}
              disabled={Boolean(playbackPlayers)}
            >
              <Share2 size={18} />
              Score: {score}
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
    if (step.kind === "lofted") {
      return `${nameFor(step.fromPlayerId, players)} clips it into space for ${nameFor(step.toPlayerId, players)}`;
    }
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
    return "Click a blue teammate to pass, or the goal to shoot. Click a completed pass line to toggle it into a lob.";
  }
  return "Click a blue player to start a movement, or click the ball to start a pass. After recording a pass, click on its line to switch between ground (default) and lob.";
}

function generationStatusText(data: LevelResponse) {
  const displayName = data.modelName ?? data.model;
  if (data.source === "fallback") {
    return `Fallback. ${displayName} failed${data.warning ? ` with reason: ${data.warning}` : "."}`;
  }

  const seconds =
    !data.buffered && typeof data.durationMs === "number"
      ? ` in ${(data.durationMs / 1000).toFixed(1)}s`
      : "";
  return `Generated by ${displayName}${seconds}`;
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
        speed: 43,
        reaction: 77,
        mistake: 0.12,
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
        isGoalkeeper(player) ||
        player.x <= finalShot.from.x ||
        player.x >= 97
      ) {
        return false;
      }

      const laneDistance = distanceToSegment(player, finalShot.from, finalShot.to);
      return laneDistance < blockRadius(player);
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

function movementDuration(from: Point, to: Point) {
  return clamp(distance(from, to) / playerRunSpeed, 0.25, 3.2);
}

function passDuration(step: PassStep) {
  const speed = step.kind === "lofted" ? loftedPassSpeed : groundPassSpeed;
  return clamp(distance(step.from, step.to) / speed, 0.18, 1.8);
}

function secondsToMs(seconds: number) {
  return clamp(seconds * 1450, 320, 2900);
}

function playersAtTime(
  players: Player[],
  activeRuns: ActiveRun[],
  time: number,
) {
  return players.map((player) => {
    if (player.team !== "home") {
      return player;
    }

    const position = playerPositionAt(player.id, players, activeRuns, time);
    return { ...player, ...position };
  });
}

function playerPositionAt(
  playerId: string,
  players: Player[],
  activeRuns: ActiveRun[],
  time: number,
) {
  const base = players.find((player) => player.id === playerId);
  const run = [...activeRuns]
    .reverse()
    .find((candidate) => candidate.playerId === playerId);
  if (!run) {
    return base ? { x: base.x, y: base.y } : { x: 50, y: 50 };
  }

  const progress = clamp((time - run.startTime) / run.duration, 0, 1);
  return {
    x: lerp(run.from.x, run.to.x, progress),
    y: lerp(run.from.y, run.to.y, progress),
  };
}

function settleCompletedRuns(activeRuns: ActiveRun[], time: number) {
  for (let index = activeRuns.length - 1; index >= 0; index -= 1) {
    const run = activeRuns[index];
    if (time >= run.startTime + run.duration) {
      activeRuns.splice(index, 1);
    }
  }
}

function blockRadius(player: Player) {
  return 2.6 + (defenderComposite(player) / 100) * 5.2;
}

function tackleRadius(player: Player) {
  return 1.9 + (defenderComposite(player) / 100) * 3.2;
}

function passInterceptionRadius(player: Player, kind: PassStep["kind"]) {
  const base = 2.2 + (defenderComposite(player) / 100) * 4.2;
  return kind === "lofted" ? base * 0.42 : base;
}

function findRunTackle(
  activeRuns: ActiveRun[],
  players: Player[],
  fromTime: number,
  toTime: number,
): RunTackle | undefined {
  return activeRuns
    .flatMap((run) => {
      const startProgress = clamp((fromTime - run.startTime) / run.duration, 0, 1);
      const endProgress = clamp((toTime - run.startTime) / run.duration, 0, 1);
      if (endProgress <= startProgress) {
        return [];
      }

      return players
        .filter((player) => player.team === "away" && !isGoalkeeper(player))
        .map((defender) => {
          const progress = segmentProgress(defender, run.from, run.to);
          if (progress < Math.max(0.06, startProgress) || progress > Math.min(0.96, endProgress)) {
            return null;
          }

          const point = projectToSegment(defender, run.from, run.to);
          if (distance(defender, point) > tackleRadius(defender)) {
            return null;
          }

          return {
            runnerId: run.playerId,
            defender,
            point,
            time: run.startTime + run.duration * progress,
          };
        })
        .filter((tackle): tackle is RunTackle => Boolean(tackle));
    })
    .sort((left, right) => {
      const timeGap = left.time - right.time;
      return Math.abs(timeGap) > 0.05
        ? timeGap
        : defenderComposite(right.defender) - defenderComposite(left.defender);
    })[0];
}

function findPassInterception(step: PassStep, players: Player[]) {
  return players
    .filter((player) => {
      if (player.team !== "away" || isGoalkeeper(player)) {
        return false;
      }

      const progress = segmentProgress(player, step.from, step.to);
      if (progress < 0.12 || progress > 0.9) {
        return false;
      }

      return (
        distanceToSegment(player, step.from, step.to) <
        passInterceptionRadius(player, step.kind)
      );
    })
    .map((player) => ({
      player,
      progress: segmentProgress(player, step.from, step.to),
      point: projectToSegment(player, step.from, step.to),
    }))
    .sort((left, right) => {
      const scoreGap =
        defenderComposite(right.player) - defenderComposite(left.player);
      return Math.abs(scoreGap) > 6 ? scoreGap : left.progress - right.progress;
    })[0];
}

function ballActionPath(step: PassStep | ShotStep) {
  if (step.type === "pass" && step.kind === "lofted") {
    const midX = (step.from.x + step.to.x) / 2;
    const midY = (step.from.y + step.to.y) / 2;
    const lift = clamp(distance(step.from, step.to) * 0.28, 6, 14);
    return `M ${step.from.x} ${step.from.y} Q ${midX} ${midY - lift} ${step.to.x} ${step.to.y}`;
  }

  return `M ${step.from.x} ${step.from.y} L ${step.to.x} ${step.to.y}`;
}

function loftedPoint(start: Point, end: Point, progress: number, kind?: PassStep["kind"]) {
  if (kind !== "lofted") {
    return {
      x: lerp(start.x, end.x, progress),
      y: lerp(start.y, end.y, progress),
    };
  }

  const arc = Math.sin(progress * Math.PI) * 7;
  return {
    x: lerp(start.x, end.x, progress),
    y: lerp(start.y, end.y, progress) - arc,
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const projection = projectToSegment(point, start, end);
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function segmentProgress(point: Point, start: Point, end: Point) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return 0;
  }
  return clamp(
    ((point.x - start.x) * (end.x - start.x) +
      (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1,
  );
}

function projectToSegment(point: Point, start: Point, end: Point) {
  const progress = segmentProgress(point, start, end);
  return {
    x: start.x + progress * (end.x - start.x),
    y: start.y + progress * (end.y - start.y),
  };
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
