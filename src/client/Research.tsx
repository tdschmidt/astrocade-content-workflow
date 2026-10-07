import { useState, type FormEvent } from "react";
import {
  Badge,
  dateLabel,
  EmptyState,
  Field,
  Icon,
  SectionHeading,
  type ScreenProps,
} from "./components.js";

export function Research({ state, busy, mutate, navigate }: ScreenProps) {
  const [topic, setTopic] = useState(
    "Short-form gaming videos: clear challenges, satisfying transformations, and original storytelling",
  );
  const snapshots = state.workspace.research.toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const refresh = (event: FormEvent) => {
    event.preventDefault();
    void mutate("/api/research", { topic });
  };
  return (
    <div className="screen-stack">
      <section className="panel research-prompt">
        <div>
          <p className="eyebrow">A FRESH PERSPECTIVE</p>
          <h2>What are we exploring?</h2>
          <p>
            Find useful creative patterns and save the evidence for your next
            batch. Research refreshes only when you ask.
          </p>
        </div>
        <form className="form-stack" onSubmit={refresh}>
          <Field label="Research direction">
            <textarea
              rows={3}
              required
              maxLength={500}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                busy ||
                !topic.trim() ||
                !state.settings.tavilyApiKeyConfigured ||
                !state.settings.geminiApiKeyConfigured
              }
            >
              <Icon name="search" />
              Refresh research
            </button>
            {(!state.settings.tavilyApiKeyConfigured ||
              !state.settings.geminiApiKeyConfigured) && (
              <button
                className="text-button"
                type="button"
                onClick={() => navigate("setup")}
              >
                Connect research tools <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
        </form>
      </section>
      <SectionHeading eyebrow="THE NOTEBOOK" title="Saved research">
        <span className="small-text muted">
          {snapshots.length} {snapshots.length === 1 ? "snapshot" : "snapshots"}
        </span>
      </SectionHeading>
      {!snapshots.length ? (
        <div className="panel">
          <EmptyState title="An open notebook">
            Your first research refresh will save dated findings and source
            links here. A reference is a creative lead, not a promise of views.
          </EmptyState>
        </div>
      ) : (
        snapshots.map((snapshot, index) => (
          <article className="panel research-card" key={snapshot.id}>
            <div className="research-card-top">
              <p className="eyebrow">{dateLabel(snapshot.createdAt)}</p>
              {index === 0 && <Badge tone="good">Latest snapshot</Badge>}
            </div>
            <h2>{snapshot.topic}</h2>
            <p className="research-summary">{snapshot.summary}</p>
            {snapshot.terms.length > 0 && (
              <div className="term-list" aria-label="Research terms">
                {snapshot.terms.map((term) => (
                  <span key={term}>{term}</span>
                ))}
              </div>
            )}
            <details className="research-sources">
              <summary>
                {snapshot.sources.length} supporting sources{" "}
                <span>View evidence</span>
              </summary>
              <div>
                {snapshot.sources.map((source, sourceIndex) => (
                  <article
                    className="research-source"
                    key={`${source.url}:${sourceIndex}`}
                  >
                    <div>
                      <span className="source-number">
                        {String(sourceIndex + 1).padStart(2, "0")}
                      </span>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                        <Icon name="external" size={14} />
                      </a>
                    </div>
                    <p>{source.content}</p>
                    <small>
                      {source.observation === "search_excerpt"
                        ? "Search excerpt · video not directly inspected"
                        : "Extracted page text · visual content not necessarily inspected"}
                    </small>
                  </article>
                ))}
              </div>
            </details>
          </article>
        ))
      )}
    </div>
  );
}
