import { useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

type Phase = "focus" | "short" | "long";

const MINUTES: Record<Phase, number> = { focus: 25, short: 5, long: 15 };
const LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };
const STORE_KEY = "pip.pomodoro";

type Saved = { phase: Phase; secondsLeft: number; done: number };

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed.phase || !(parsed.phase in MINUTES)) throw new Error("bad phase");
    return {
      phase: parsed.phase,
      secondsLeft:
        typeof parsed.secondsLeft === "number" && parsed.secondsLeft >= 0
          ? parsed.secondsLeft
          : MINUTES[parsed.phase] * 60,
      done: typeof parsed.done === "number" ? parsed.done : 0,
    };
  } catch {
    return { phase: "focus", secondsLeft: MINUTES.focus * 60, done: 0 };
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
    // Notifications are best-effort; the in-app state is the source of truth.
  }
}

function format(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Pomodoro() {
  // Lazy initialiser: load() reads localStorage once, on first render only.
  const [initial] = useState(load);
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
    const nextPhase: Phase =
      phase === "focus" ? (nextDone % 4 === 0 ? "long" : "short") : "focus";

    setDone(nextDone);
    setPhase(nextPhase);
    setSecondsLeft(MINUTES[nextPhase] * 60);
    void notify(phase, nextPhase);
  }, [secondsLeft, running, phase, done]);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ phase, secondsLeft, done }));
  }, [phase, secondsLeft, done]);

  function reset() {
    setRunning(false);
    setSecondsLeft(MINUTES[phase] * 60);
  }

  function skip() {
    const nextDone = phase === "focus" ? done + 1 : done;
    const nextPhase: Phase =
      phase === "focus" ? (nextDone % 4 === 0 ? "long" : "short") : "focus";
    setDone(nextDone);
    setPhase(nextPhase);
    setSecondsLeft(MINUTES[nextPhase] * 60);
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
    </section>
  );
}

export default Pomodoro;
