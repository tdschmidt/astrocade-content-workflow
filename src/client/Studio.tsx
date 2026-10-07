import { useRef, useState, type FormEvent } from "react";
import type { Draft, RunOptions, VideoFormat } from "../shared/domain.js";
import type { GameCandidate } from "../server/games/schema.js";
import {
  Badge,
  dateLabel,
  displayStatus,
  EmptyState,
  Field,
  Icon,
  mediaUrl,
  SectionHeading,
  type ScreenProps,
} from "./components.js";

const formatLabels: Record<VideoFormat, string> = {
  highlight: "Gameplay highlight",
  recommendation: "Narrated recommendation",
  story: "Story or explainer",
};
const modeLabels = {
  balanced: "Balanced",
  popular: "Popular",
  visual: "Visual",
  trend: "Trend-led",
};

export function Studio(props: ScreenProps) {
  const { state, busy, mutate, navigate } = props;
  const { workspace, jobs } = state;
  const [options, setOptions] = useState<RunOptions>({
    mode: "balanced",
    formats: ["highlight"],
    comparison: "same-game",
    profileIds: [],
    topic: "",
  });
  const [profileJson, setProfileJson] = useState("");
  const [profileError, setProfileError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLDetailsElement>(null);
  const readyProfiles = workspace.profiles.filter(
    (profile) => profile.verification === "verified",
  );
  const activeJob = jobs.find((job) => job.status === "running");
  const recentJob = jobs.toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const job = activeJob ?? recentJob;
  const latestDrafts = [
    ...workspace.drafts
      .reduce((map, draft) => {
        if (!map.has(draft.id) || map.get(draft.id)!.revision < draft.revision)
          map.set(draft.id, draft);
        return map;
      }, new Map<string, Draft>())
      .values(),
  ].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectProfile = (id: string) =>
    setOptions((value) => ({
      ...value,
      profileIds: value.profileIds.includes(id)
        ? value.profileIds.filter((item) => item !== id)
        : [...value.profileIds, id],
    }));
  const toggleFormat = (format: VideoFormat) =>
    setOptions((value) => ({
      ...value,
      formats: value.formats.includes(format)
        ? value.formats.filter((item) => item !== format)
        : [...value.formats, format],
    }));
  const configure = (candidate: GameCandidate) => {
    setProfileJson(
      JSON.stringify(
        {
          id: `game-${candidate.id
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 60)}`,
          name: candidate.title,
          gameUrl: candidate.url,
          verification: "unverified",
          viewport: { width: 1080, height: 1920 },
          ready: { selector: "canvas", frames: [] },
          surface: { selector: "canvas", frames: [] },
          setup: [],
          start: [],
          reset: [],
          focus: "click",
          objective: "Produce a clear interaction and visible outcome.",
          maxDurationMs: 60000,
          controller: { type: "sparse", maxDecisions: 6 },
        },
        null,
        2,
      ),
    );
    setEditorOpen(true);
    setProfileError("");
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
  };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError("");
    try {
      const profile: unknown = JSON.parse(profileJson);
      await mutate("/api/profiles", profile);
    } catch {
      setProfileError(
        "This profile is not valid JSON. Check its brackets, commas, and quotation marks.",
      );
    }
  };
  const createRun = (event: FormEvent) => {
    event.preventDefault();
    void mutate("/api/runs", options);
  };

  return (
    <div className="screen-stack">
      {workspace.discovery?.status === "unavailable" && (
        <div className="notice notice-warn">
          <div>
            <strong>Astrocade is currently unreachable.</strong>
            <p>
              Restore access to Astrocade in your browser, then retry discovery.
              Your saved work stays here.
            </p>
          </div>
          <button
            className="button small secondary"
            disabled={busy}
            onClick={() => void mutate("/api/discover")}
          >
            Try discovery again
          </button>
        </div>
      )}
      <div className="studio-top-grid">
        <section className="panel compose-panel">
          <SectionHeading
            eyebrow="01 / CREATIVE DIRECTION"
            title="Make a video"
          />
          <form onSubmit={createRun} className="form-stack">
            <p className="field-hint">
              Capture a game and make a short gameplay highlight. Review the
              video and caption before publishing.
            </p>
            <button
              className="button primary full-width"
              disabled={
                busy || !options.formats.length || !readyProfiles.length
              }
            >
              <Icon name="star" />
              {options.formats.length > 1
                ? "Create videos"
                : "Create video"}{" "}
              <Icon name="arrow" />
            </button>
            {!readyProfiles.length && (
              <p className="field-hint">
                No game is ready to capture yet. Discover games and check their
                capture status below.
              </p>
            )}
            <details className="advanced-panel">
              <summary>Options</summary>
              <div className="advanced-body form-stack">
                <div className="field">
                  <span>Choose your angle</span>
                  <div
                    className="segmented"
                    role="group"
                    aria-label="Game selection mode"
                  >
                    {(Object.keys(modeLabels) as Array<RunOptions["mode"]>).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={options.mode === mode ? "selected" : ""}
                          aria-pressed={options.mode === mode}
                          onClick={() =>
                            setOptions((value) => ({ ...value, mode }))
                          }
                        >
                          {modeLabels[mode]}
                        </button>
                      ),
                    )}
                  </div>
                  <small>
                    {options.mode === "trend"
                      ? "Use the latest saved research. If no game fits, the studio will say so."
                      : options.mode === "popular"
                        ? "Prioritize observed public counters. Missing numbers stay unknown."
                        : options.mode === "visual"
                          ? "Prioritize visual evidence and footage that reads clearly on a phone."
                          : "Balance the available evidence, visual fit, and creative potential."}
                  </small>
                </div>
                <fieldset className="plain-fieldset">
                  <legend>Video formats</legend>
                  <div className="format-options">
                    {(Object.keys(formatLabels) as VideoFormat[]).map(
                      (format) => (
                        <label
                          key={format}
                          className={`check-card ${options.formats.includes(format) ? "chosen" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={options.formats.includes(format)}
                            onChange={() => toggleFormat(format)}
                          />
                          <span>{formatLabels[format]}</span>
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <Field label="Game comparison">
                  <select
                    value={options.comparison}
                    onChange={(e) =>
                      setOptions((value) => ({
                        ...value,
                        comparison: e.target.value as RunOptions["comparison"],
                      }))
                    }
                  >
                    <option value="best-fit">Best game for each format</option>
                    <option value="same-game">Same game across formats</option>
                  </select>
                </Field>
                {options.formats.includes("story") && (
                  <Field
                    label="Story direction"
                    hint="Ask for original fiction or a factual explainer. Claims need sources."
                  >
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={options.topic}
                      onChange={(e) =>
                        setOptions((value) => ({
                          ...value,
                          topic: e.target.value,
                        }))
                      }
                    />
                  </Field>
                )}
                {readyProfiles.length > 0 && (
                  <fieldset className="plain-fieldset">
                    <legend>Capture-ready games</legend>
                    <p className="field-hint">
                      Leave all unchecked to let the studio choose.
                    </p>
                    <div className="profile-choices">
                      {readyProfiles.map((profile) => (
                        <label key={profile.id} className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={options.profileIds.includes(profile.id)}
                            onChange={() => selectProfile(profile.id)}
                          />
                          {profile.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            </details>
          </form>
        </section>
        <section className="panel session-panel">
          <SectionHeading
            eyebrow="02 / THE WORK IN PROGRESS"
            title="On the worktable"
          />
          {job ? (
            <div className="job-state">
              <div className="job-top">
                <Badge
                  tone={
                    job.status === "running"
                      ? "warn"
                      : job.status === "completed"
                        ? "good"
                        : job.status === "failed"
                          ? "bad"
                          : "neutral"
                  }
                >
                  {displayStatus(job.status)}
                </Badge>
                <span className="muted small-text">
                  {dateLabel(job.updatedAt)}
                </span>
              </div>
              <h3>{displayStatus(job.kind)}</h3>
              <p className="job-step" aria-live="polite">
                {job.step}
              </p>
              {job.status === "running" && (
                <div className="activity-line" aria-hidden="true">
                  <span />
                </div>
              )}
              {job.error && (
                <p className="notice notice-warn compact">{job.error}</p>
              )}
              {job.status === "running" && (
                <button
                  className="button small secondary"
                  onClick={() => void mutate(`/api/jobs/${job.id}/cancel`)}
                >
                  Cancel operation
                </button>
              )}
            </div>
          ) : (
            <div className="worktable-empty">
              <div className="film-illustration" aria-hidden="true">
                <div />
                <div />
                <div />
              </div>
              <h3>A good moment starts here.</h3>
              <p>
                Discover a game, choose your angle, and the studio will capture,
                write, and assemble your first drafts.
              </p>
              <div className="workflow-labels">
                <span>CAPTURE</span>
                <i />
                <span>CREATE</span>
                <i />
                <span>REVIEW</span>
              </div>
            </div>
          )}
          <div className="readiness-strip">
            <span>
              <i
                className={`mini-dot ${state.settings.geminiApiKeyConfigured ? "good" : ""}`}
              />
              {state.settings.geminiApiKeyConfigured
                ? "Creative tools connected"
                : "Creative tools need setup"}
            </span>
            <button className="text-button" onClick={() => navigate("setup")}>
              Open setup <Icon name="arrow" size={14} />
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <SectionHeading
          eyebrow="THE GAME SHELF"
          title="Discover your next subject"
        >
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => void mutate("/api/discover")}
          >
            <Icon name="search" size={16} />
            {workspace.candidates.length ? "Refresh games" : "Discover games"}
          </button>
        </SectionHeading>
        {workspace.discovery && (
          <p className="section-note">
            Last checked {dateLabel(workspace.discovery.observedAt)} ·{" "}
            {displayStatus(workspace.discovery.status)} · Public page
            observations
          </p>
        )}
        {!workspace.candidates.length ? (
          <EmptyState title="Your game shelf is empty">
            Discover live Astrocade games to build a shortlist. Games are
            evaluated for usable play and an understandable moment.
          </EmptyState>
        ) : (
          <div className="candidate-grid">
            {workspace.candidates.map((candidate) => (
              <article className="candidate-card" key={candidate.id}>
                <div className="candidate-art">
                  {candidate.thumbnailUrl ? (
                    <img
                      src={candidate.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Icon name="play" size={30} />
                  )}
                </div>
                <div className="candidate-copy">
                  <h3>
                    <a href={candidate.url} target="_blank" rel="noreferrer">
                      {candidate.title}
                      <Icon name="external" size={13} />
                    </a>
                  </h3>
                  {candidate.creator && (
                    <p className="small-text muted">by {candidate.creator}</p>
                  )}
                  <p className="candidate-metrics">
                    {candidate.metrics.length
                      ? candidate.metrics
                          .map((metric) => metric.raw)
                          .join(" · ")
                      : "Public counts not observed"}
                  </p>
                  <div className="candidate-bottom">
                    <span className="tiny-text">
                      Capture{" "}
                      {workspace.profiles.find(
                        (p) => p.gameUrl === candidate.url,
                      )?.verification === "verified"
                        ? "verified"
                        : "unverified"}
                    </span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => configure(candidate)}
                    >
                      Configure <Icon name="plus" size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {workspace.discovery?.sources.some((source) => source.message) && (
          <details className="source-details">
            <summary>Discovery notes</summary>
            {workspace.discovery.sources.map((source) => (
              <p key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {new URL(source.url).pathname}
                </a>{" "}
                —{" "}
                {source.message ??
                  `${source.candidateCount} game links observed`}
              </p>
            ))}
          </details>
        )}
        <details
          ref={editorRef}
          open={editorOpen}
          onToggle={(e) => setEditorOpen(e.currentTarget.open)}
          className="advanced-panel"
        >
          <summary>
            Advanced · game capture profiles{" "}
            <span>{workspace.profiles.length} saved</span>
          </summary>
          <div className="advanced-body">
            <p className="muted small-text">
              Profiles describe a game's real controls, start/reset steps, and
              capture objective. Templates are unverified. Inspect the game,
              correct the profile, then test two captures.
            </p>
            {workspace.profiles.length > 0 && (
              <div className="saved-profiles">
                {workspace.profiles.map((profile) => (
                  <div className="saved-profile" key={profile.id}>
                    <div>
                      <strong>{profile.name}</strong>
                      <Badge
                        tone={
                          profile.verification === "verified" ? "good" : "warn"
                        }
                      >
                        {profile.verification}
                      </Badge>
                    </div>
                    <div className="button-row">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          setProfileJson(JSON.stringify(profile, null, 2))
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="button small secondary"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/api/profiles/${profile.id}/probe`)
                        }
                      >
                        Test capture twice
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={saveProfile} className="form-stack">
              <Field label="Profile JSON">
                <textarea
                  className="code-input"
                  rows={12}
                  spellCheck={false}
                  value={profileJson}
                  onChange={(e) => setProfileJson(e.target.value)}
                  placeholder="Choose Configure on a game, or paste an inspected profile."
                />
              </Field>
              {profileError && (
                <p className="notice notice-bad compact" role="alert">
                  {profileError}
                </p>
              )}
              <button
                className="button secondary align-start"
                disabled={busy || !profileJson.trim()}
              >
                Save profile
              </button>
            </form>
          </div>
        </details>
      </section>

      <section>
        <SectionHeading
          eyebrow="03 / YOUR FINAL SAY"
          title="Drafts & published work"
        >
          <span className="muted small-text">
            {latestDrafts.length}{" "}
            {latestDrafts.length === 1 ? "draft" : "drafts"}
          </span>
        </SectionHeading>
        {!latestDrafts.length ? (
          <div className="panel">
            <EmptyState title="Room for your first video">
              Finished drafts will appear here with a preview and editable copy.
              Every published version requires your explicit approval.
            </EmptyState>
          </div>
        ) : (
          <div className="draft-list">
            {latestDrafts.map((draft) => (
              <DraftCard
                key={`${draft.id}:${draft.revision}`}
                draft={draft}
                {...props}
              />
            ))}
          </div>
        )}
      </section>
      {workspace.runs.some((run) =>
        ["needs_attention", "failed", "pending"].includes(run.status),
      ) && (
        <section className="panel">
          <SectionHeading title="Pick up where you left off" />
          <div className="resume-list">
            {workspace.runs
              .filter((run) =>
                ["needs_attention", "failed", "pending"].includes(run.status),
              )
              .map((run) => (
                <div key={run.id} className="resume-row">
                  <div>
                    <strong>
                      {run.options.formats
                        .map((format) => formatLabels[format])
                        .join(" + ")}
                    </strong>
                    <p>{run.message ?? displayStatus(run.status)}</p>
                    <small>{dateLabel(run.createdAt)}</small>
                  </div>
                  <button
                    className="button small secondary"
                    disabled={busy}
                    onClick={() => void mutate(`/api/runs/${run.id}/resume`)}
                  >
                    Resume <Icon name="arrow" size={15} />
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  state,
  busy,
  mutate,
}: ScreenProps & { draft: Draft }) {
  const [hook, setHook] = useState(draft.hook);
  const [narration, setNarration] = useState(draft.narration);
  const [caption, setCaption] = useState(draft.caption);
  const [reviewed, setReviewed] = useState(false);
  const dirty =
    hook !== draft.hook ||
    narration !== draft.narration ||
    caption !== draft.caption;
  const capture = state.workspace.captures.find(
    (item) => item.id === draft.captureId,
  );
  const publication = state.workspace.publications.find(
    (item) => item.draftId === draft.id && item.revision === draft.revision,
  );
  const published = publication?.result?.permalink;
  const unresolvedPublication = state.workspace.publications.find(
    (item) =>
      item.draftId === draft.id && item.intent && !item.result?.permalink,
  );
  const uncertain = Boolean(unresolvedPublication);
  const intendedAccount = String(state.settings.instagramUsername ?? "");
  const requiresAiDisclosure = Boolean(draft.narration.trim());
  const approvalMatches = draft.approval?.accountUsername === intendedAccount;
  const editDisabled = busy || uncertain;
  const ready = draft.status === "ready" && Boolean(draft.videoPath);
  const path = `/api/drafts/${draft.id}/revisions/${draft.revision}`;
  return (
    <article className="panel draft-card">
      <div className="draft-header">
        <div>
          <Badge>{formatLabels[draft.format]}</Badge>
          <span className="small-text muted">
            Version {draft.revision} · {dateLabel(draft.createdAt)}
          </span>
        </div>
        <Badge
          tone={published ? "good" : draft.status === "ready" ? "good" : "warn"}
        >
          {published ? "Published" : displayStatus(draft.status)}
        </Badge>
      </div>
      <div className="draft-body">
        <div className="draft-media-column">
          <div className="phone-preview">
            {ready ? (
              <video
                controls
                playsInline
                preload="metadata"
                src={mediaUrl(draft.videoPath!)}
                aria-label={`${draft.hook}, version ${draft.revision}`}
              />
            ) : (
              <div className="video-placeholder">
                <Icon name="play" size={32} />
                <span>
                  {draft.status === "rendering"
                    ? "Assembling your video…"
                    : "Preview will appear when this draft is ready."}
                </span>
              </div>
            )}
          </div>
          {capture && (
            <a
              className="source-game"
              href={capture.game.url}
              target="_blank"
              rel="noreferrer"
            >
              {capture.game.title}
              <Icon name="external" size={13} />
            </a>
          )}
          {published && (
            <a
              href={published}
              className="button secondary small"
              target="_blank"
              rel="noreferrer"
            >
              View on Instagram <Icon name="external" size={14} />
            </a>
          )}
        </div>
        <div className="draft-copy">
          <Field label="Opening hook">
            <input
              value={hook}
              maxLength={120}
              disabled={editDisabled}
              onChange={(e) => {
                setHook(e.target.value);
                setReviewed(false);
              }}
            />
          </Field>
          <Field label="Narration">
            <textarea
              value={narration}
              rows={4}
              maxLength={1600}
              disabled={editDisabled}
              onChange={(e) => {
                setNarration(e.target.value);
                setReviewed(false);
              }}
            />
          </Field>
          <Field label="Instagram caption">
            <textarea
              value={caption}
              rows={4}
              maxLength={2200}
              disabled={editDisabled}
              onChange={(e) => {
                setCaption(e.target.value);
                setReviewed(false);
              }}
            />
          </Field>
          <div className="copy-save-row">
            <small>
              {uncertain
                ? "Resolve the earlier publication attempt before changing this draft."
                : dirty
                  ? "Unsaved changes · save before approval or publication."
                  : "This copy belongs to the previewed version."}
            </small>
            <button
              className="button secondary small"
              disabled={
                editDisabled || !dirty || !hook.trim() || !caption.trim()
              }
              onClick={() =>
                void mutate(`${path}/edit`, { hook, narration, caption })
              }
            >
              Save changes
            </button>
          </div>
          {draft.rationale && (
            <details className="source-details">
              <summary>Why this edit</summary>
              <p>{draft.rationale}</p>
            </details>
          )}
          {draft.warnings.length > 0 && (
            <div className="notice notice-warn compact">
              <strong>Review notes</strong>
              <ul>
                {draft.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {(!published || uncertain) && (
        <div className="approval-bar">
          {uncertain ? (
            <>
              <div>
                <strong>
                  Version {unresolvedPublication?.revision} publication needs
                  checking
                </strong>
                <p>
                  {unresolvedPublication?.result?.reason ??
                    "An earlier attempt may have reached Instagram. Check that result before sharing again."}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/api/drafts/${draft.id}/revisions/${unresolvedPublication!.revision}/reconcile`,
                  )
                }
              >
                Check publication
              </button>
            </>
          ) : draft.approval && approvalMatches && !dirty ? (
            <>
              <div className="approved-copy">
                <Icon name="check" />
                <span>
                  <strong>
                    Version {draft.revision} approved for @
                    {draft.approval.accountUsername}
                  </strong>
                  <small>
                    Video and caption approved.{" "}
                    {draft.approval.requiresAiDisclosure
                      ? "AI disclosure will be enabled."
                      : "AI disclosure is not required for this version."}
                  </small>
                </span>
              </div>
              <button
                className="button primary"
                disabled={busy || !ready}
                onClick={() => void mutate(`${path}/publish`)}
              >
                Publish to Instagram <Icon name="arrow" />
              </button>
            </>
          ) : (
            <>
              <label className="checkbox-row review-checkbox">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={!ready || dirty || busy || !intendedAccount}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  I reviewed this video and caption.
                  <small>
                    Version {draft.revision} for{" "}
                    {intendedAccount
                      ? `@${intendedAccount}`
                      : "the account still to be configured"}
                    .{" "}
                    {requiresAiDisclosure
                      ? "AI disclosure will be enabled for the generated narration."
                      : "No generated narration; AI disclosure is not required for this version."}
                  </small>
                </span>
              </label>
              <button
                className="button primary"
                disabled={
                  busy || !ready || dirty || !reviewed || !intendedAccount
                }
                onClick={() =>
                  void mutate(`${path}/approve`, { reviewed: true })
                }
              >
                Approve version {draft.revision}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
