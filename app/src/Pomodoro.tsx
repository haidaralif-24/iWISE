import { useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

type Phase = "focus" | "short" | "long";
type Durations = Record<Phase, number>;

const PHASES: Phase[] = ["focus", "short", "long"];

const DEFAULT_DURATIONS: Durations = { focus: 25, short: 5, long: 15 };
const LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };
const SHORT_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short", long: "Long" };

const STATE_KEY = "pip.pomodoro";
const DURATIONS_KEY = "pip.pomodoro.durations";

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

function clampMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(value)));
}

function loadDurations(): Durations {
  try {
    const raw = localStorage.getItem(DURATIONS_KEY);
    if (!raw) return DEFAULT_DURATIONS;
    const parsed = JSON.parse(raw) as Partial<Durations>;
    return {
      focus: clampMinutes(parsed.focus, DEFAULT_DURATIONS.focus),
      short: clampMinutes(parsed.short, DEFAULT_DURATIONS.short),
      long: clampMinutes(parsed.long, DEFAULT_DURATIONS.long),
    };
  } catch {
    return DEFAULT_DURATIONS;
  }
}

type Saved = { phase: Phase; secondsLeft: number; done: number };

function loadState(durations: Durations): Saved {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed.phase || !PHASES.includes(parsed.phase)) throw new Error("bad phase");
    return {
      phase: parsed.phase,
      secondsLeft:
        typeof parsed.secondsLeft === "number" && parsed.secondsLeft >= 0
          ? parsed.secondsLeft
          : durations[parsed.phase] * 60,
      done: typeof parsed.done === "number" ? parsed.done : 0,
    };
  } catch {
    return { phase: "focus", secondsLeft: durations.focus * 60, done: 0 };
  }
}

async function notify(finished: Phase, next: Phase) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    sendNotification({
      title: finished === "focus" ? "Focus session done" : "Break over",
      body: finished === "focus" ? `Time for a ${LABEL[next].toLowerCase()}.` : "Back to focus.",
    });
  } catch {
    // Best effort; the in-app state is the source of truth.
  }
}

function format(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function nextPhaseAfter(finished: Phase, doneAfter: number): Phase {
  if (finished !== "focus") return "focus";
  return doneAfter % 4 === 0 ? "long" : "short";
}

function Pomodoro() {
  // Settings are read first so the restored countdown can fall back to them.
  const [durations, setDurations] = useState<Durations>(loadDurations);
  const [initial] = useState(() => loadState(durations));

  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [secondsLeft, setSecondsLeft] = useState(initial.secondsLeft);
  const [done, setDone] = useState(initial.done);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running || secondsLeft > 0) return;

    const nextDone = phase === "focus" ? done + 1 : done;
    const next = nextPhaseAfter(phase, nextDone);

    setDone(nextDone);
    setPhase(next);
    setSecondsLeft(durations[next] * 60);
    void notify(phase, next);
  }, [secondsLeft, running, phase, done, durations]);

  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ phase, secondsLeft, done }));
  }, [phase, secondsLeft, done]);

  // Editing the duration of the phase you are looking at restarts that phase,
  // so the change is visible immediately instead of taking effect silently later.
  function setDuration(which: Phase, raw: string) {
    const minutes = clampMinutes(Number(raw), durations[which]);
    if (minutes === durations[which]) return;

    const next = { ...durations, [which]: minutes };
    setDurations(next);
    localStorage.setItem(DURATIONS_KEY, JSON.stringify(next));

    if (which === phase) {
      setRunning(false);
      setSecondsLeft(minutes * 60);
    }
  }

  function reset() {
    setRunning(false);
    setSecondsLeft(durations[phase] * 60);
  }

  function skip() {
    const nextDone = phase === "focus" ? done + 1 : done;
    const next = nextPhaseAfter(phase, nextDone);
    setDone(nextDone);
    setPhase(next);
    setSecondsLeft(durations[next] * 60);
  }

  function restoreDefaults() {
    setDurations(DEFAULT_DURATIONS);
    localStorage.setItem(DURATIONS_KEY, JSON.stringify(DEFAULT_DURATIONS));
    setRunning(false);
    setSecondsLeft(DEFAULT_DURATIONS[phase] * 60);
  }

  const cycle = done % 4;

  return (
    <section className="card">
      <div className="timer-head">
        <h2>Pomodoro</h2>
        <span className={running ? "pill live" : "pill"}>{running ? "running" : "paused"}</span>
      </div>

      <div className="timer-face">
        <div className={phase === "focus" ? "time" : "time break"}>{format(secondsLeft)}</div>
        <div className="phase">{LABEL[phase]}</div>
      </div>

      <div className="dots" aria-label={`${cycle} of 4 focus sessions in this cycle`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < cycle ? "dot on" : "dot"} />
        ))}
      </div>

      <div className="timer-actions">
        <button className="primary" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Start"}
        </button>
        <button onClick={reset}>Reset</button>
        <button onClick={skip}>Skip</button>
      </div>

      <div className="durations">
        {PHASES.map((p) => (
          <label key={p} className="dur">
            <span>{SHORT_LABEL[p]}</span>
            <input
              type="number"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              value={durations[p]}
              title={`${LABEL[p]} length in minutes`}
              onChange={(event) => setDuration(p, event.currentTarget.value)}
            />
          </label>
        ))}
        <button className="link" onClick={restoreDefaults} title="Restore 25 / 5 / 15">
          defaults
        </button>
      </div>
    </section>
  );
}

export default Pomodoro;
