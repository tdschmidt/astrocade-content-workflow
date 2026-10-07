import { useEffect, useState, type FormEvent } from "react";
import { useWorkbench } from "./api.js";
import { Badge, displayStatus, Icon, type Screen } from "./components.js";
import { Studio } from "./Studio.js";
import { Research } from "./Research.js";
import { Setup } from "./Setup.js";

export function App() {
  const { state, error, setError, locked, pending, mutate } = useWorkbench();
  const [screen, setScreen] = useState<Screen>("studio");
  const [password, setPassword] = useState("");
  const [dismissedJob, setDismissedJob] = useState("");
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate("/api/login", { password })) setPassword("");
  };
  if (locked)
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={login}>
          <div className="brand-mark">
            <Icon name="star" size={28} />
          </div>
          <p className="eyebrow">ASTROCADE CONTENT STUDIO</p>
          <h1>
            Your studio,
            <br />
            just a password away.
          </h1>
          <p>Enter the shared workbench password to open this workspace.</p>
          <label className="field">
            <span>Workbench password</span>
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="notice notice-bad" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={pending}>
            Open studio <Icon name="arrow" />
          </button>
        </form>
      </main>
    );
  const published = new Set(
    state?.workspace.publications.flatMap((p) =>
      p.result?.permalink ? [p.result.permalink] : [],
    ) ?? [],
  ).size;
  const currentJob =
    state?.jobs.find((job) => job.status === "running") ??
    state?.jobs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const showJob =
    currentJob &&
    screen !== "studio" &&
    currentJob.id !== dismissedJob &&
    (currentJob.status === "running" ||
      ["failed", "needs_attention", "interrupted"].includes(currentJob.status));
  const titles: Record<
    Screen,
    { eyebrow: string; title: string; description: string }
  > = {
    studio: {
      eyebrow: "MAKE SOMETHING WORTH WATCHING",
      title: "Content studio",
      description: "Find a game. Capture a moment. Give it a story.",
    },
    research: {
      eyebrow: "GOOD IDEAS START WITH EVIDENCE",
      title: "The research desk",
      description:
        "Save useful signals, creative references, and the sources behind them.",
    },
    setup: {
      eyebrow: "A LITTLE SETUP, THEN CREATE",
      title: "Studio setup",
      description:
        "Connect your creative tools and prepare a fresh Instagram account.",
    },
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="#studio" className="brand" onClick={() => setScreen("studio")}>
          <span className="brand-mark">
            <Icon name="star" size={25} />
          </span>
          <span>
            ASTROCADE<small>CONTENT STUDIO</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(["studio", "research", "setup"] as const).map((item) => (
            <button
              key={item}
              className={`nav-item ${screen === item ? "active" : ""}`}
              aria-current={screen === item ? "page" : undefined}
              onClick={() => setScreen(item)}
            >
              <Icon
                name={
                  item === "studio"
                    ? "play"
                    : item === "research"
                      ? "search"
                      : "settings"
                }
              />
              {item === "studio"
                ? "Studio"
                : item === "research"
                  ? "Research"
                  : "Setup"}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="edition-line" />
          <span className="eyebrow">
            SMALL GAMES.
            <br />
            GOOD STORIES.
          </span>
          <p>
            A local creative workspace.
            <br />
            You choose what goes live.
          </p>
        </div>
      </aside>
      <main id="main-content" className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">{titles[screen].eyebrow}</p>
            <h1>{titles[screen].title}</h1>
            <p className="page-description">{titles[screen].description}</p>
          </div>
          <div className="header-meta">
            <Badge tone={state?.busy ? "warn" : "neutral"}>
              <span className={`status-dot ${state?.busy ? "working" : ""}`} />
              {state?.busy ? "Work in progress" : "Local workspace"}
            </Badge>
            <span>{published} / 2 videos published</span>
          </div>
        </header>
        {error && (
          <div className="notice notice-bad global-notice" role="alert">
            <span>{error}</span>
            <button
              className="text-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}
        {showJob && (
          <div className="global-job" role="status">
            <Badge tone={currentJob.status === "failed" ? "bad" : "warn"}>
              {displayStatus(currentJob.status)}
            </Badge>
            <div>
              <strong>{currentJob.kind}</strong>
              <p>{currentJob.error ?? currentJob.step}</p>
            </div>
            {currentJob.status === "running" ? (
              <button
                className="text-button"
                disabled={pending}
                onClick={() => void mutate(`/api/jobs/${currentJob.id}/cancel`)}
              >
                Cancel
              </button>
            ) : (
              <button
                className="text-button"
                onClick={() => setDismissedJob(currentJob.id)}
              >
                Dismiss
              </button>
            )}
          </div>
        )}
        {!state ? (
          <div className="loading-state" role="status">
            <span className="loading-dot" />
            Opening your workspace…
          </div>
        ) : (
          <>
            {screen === "studio" && (
              <Studio
                state={state}
                busy={pending || state.busy}
                mutate={mutate}
                navigate={setScreen}
              />
            )}{" "}
            {screen === "research" && (
              <Research
                state={state}
                busy={pending || state.busy}
                mutate={mutate}
                navigate={setScreen}
              />
            )}{" "}
            {screen === "setup" && (
              <Setup
                state={state}
                busy={pending || state.busy}
                mutate={mutate}
                navigate={setScreen}
              />
            )}
          </>
        )}
        <footer className="page-footer">
          <span>Built around real gameplay.</span>
          <span>Draft first. Publish deliberately.</span>
        </footer>
      </main>
    </div>
  );
}
