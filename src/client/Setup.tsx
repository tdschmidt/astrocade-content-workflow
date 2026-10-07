import { useEffect, useState, type FormEvent } from "react";
import { request } from "./api.js";
import {
  Badge,
  displayStatus,
  Field,
  Icon,
  SectionHeading,
  type ScreenProps,
} from "./components.js";

type Check = {
  name: string;
  status: "ready" | "missing" | "failed";
  message: string;
};
const configured = (settings: Record<string, unknown>, field: string) =>
  Boolean(settings[`${field}Configured`]);
const savedString = (settings: Record<string, unknown>, field: string) =>
  typeof settings[field] === "string" ? (settings[field] as string) : "";

export function Setup(props: ScreenProps) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const check = async (signal?: AbortSignal) => {
    setChecking(true);
    setCheckError("");
    try {
      const result = await request<{ checks: Check[] }>(
        "/api/doctor",
        undefined,
        signal,
      );
      if (!signal?.aborted) setChecks(result.checks);
    } catch (error) {
      if (!signal?.aborted)
        setCheckError(
          error instanceof Error
            ? error.message
            : "Could not check this workspace.",
        );
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    void check(abort.signal);
    return () => abort.abort();
  }, []);
  return (
    <div className="screen-stack">
      <div className="setup-intro">
        <span className="setup-number">01—03</span>
        <p>
          Connect the tools, prepare the account, and check the workspace.
          <br />
          Your settings stay with this local studio.
        </p>
      </div>
      <div className="setup-grid">
        <ToolConnections {...props} />
        <AccessSettings {...props} />
      </div>
      <AccountSettings {...props} />
      <section className="panel">
        <SectionHeading
          eyebrow="WORKSPACE CHECK"
          title="Ready to make something?"
        >
          <button
            className="button secondary small"
            disabled={checking || props.busy}
            onClick={() => void check()}
          >
            {checking ? "Checking…" : "Refresh checks"}
          </button>
        </SectionHeading>
        <p className="section-note">
          These checks confirm local prerequisites. Live game access, model
          access, and Instagram readiness are tested when used.
        </p>
        {checkError && (
          <p className="notice notice-bad compact" role="alert">
            {checkError}
          </p>
        )}
        {!checks.length && checking ? (
          <p className="muted" role="status">
            Checking the workspace…
          </p>
        ) : (
          <div className="check-list">
            {checks.map((item) => (
              <div className="readiness-check" key={item.name}>
                <span className={`check-symbol ${item.status}`}>
                  {item.status === "ready" ? (
                    <Icon name="check" size={15} />
                  ) : (
                    "!"
                  )}
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.message}</p>
                </div>
                <Badge
                  tone={
                    item.status === "ready"
                      ? "good"
                      : item.status === "failed"
                        ? "bad"
                        : "warn"
                  }
                >
                  {item.status === "ready"
                    ? "Ready"
                    : item.status === "failed"
                      ? "Needs attention"
                      : "Not configured"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ToolConnections({ state, busy, mutate }: ScreenProps) {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const patch = {
      ...(geminiApiKey.trim() ? { geminiApiKey: geminiApiKey.trim() } : {}),
      ...(tavilyApiKey.trim() ? { tavilyApiKey: tavilyApiKey.trim() } : {}),
    };
    if (await mutate("/api/settings", patch)) {
      setGeminiApiKey("");
      setTavilyApiKey("");
      setSaved(true);
    }
  };
  return (
    <section className="panel">
      <SectionHeading
        eyebrow="01 / CREATIVE TOOLS"
        title="A little intelligence"
      />
      <form className="form-stack" onSubmit={save}>
        <div className="provider-heading">
          <span>Google Gemini</span>
          <Badge
            tone={
              configured(state.settings, "geminiApiKey") ? "good" : "neutral"
            }
          >
            {configured(state.settings, "geminiApiKey")
              ? "Key saved"
              : "Required"}
          </Badge>
        </div>
        <p className="field-hint">
          For gameplay analysis, writing, narration, and captions.{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Get a Gemini key <Icon name="external" size={12} />
          </a>
        </p>
        <Field label="Gemini API key">
          <input
            type="password"
            autoComplete="off"
            value={geminiApiKey}
            placeholder={
              configured(state.settings, "geminiApiKey")
                ? "Saved · enter a replacement to change"
                : "Enter your API key"
            }
            onChange={(event) => {
              setGeminiApiKey(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <div className="provider-heading">
          <span>Tavily research</span>
          <Badge
            tone={
              configured(state.settings, "tavilyApiKey") ? "good" : "neutral"
            }
          >
            {configured(state.settings, "tavilyApiKey")
              ? "Key saved"
              : "For research"}
          </Badge>
        </div>
        <p className="field-hint">
          For web research and source links.{" "}
          <a href="https://app.tavily.com" target="_blank" rel="noreferrer">
            Get a Tavily key <Icon name="external" size={12} />
          </a>
        </p>
        <Field label="Tavily API key">
          <input
            type="password"
            autoComplete="off"
            value={tavilyApiKey}
            placeholder={
              configured(state.settings, "tavilyApiKey")
                ? "Saved · enter a replacement to change"
                : "Enter your API key"
            }
            onChange={(event) => {
              setTavilyApiKey(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy || (!geminiApiKey.trim() && !tavilyApiKey.trim())}
          >
            Save connections
          </button>
          {saved && (
            <span className="saved-message" role="status">
              <Icon name="check" size={15} />
              Connections saved
            </span>
          )}
        </div>
      </form>
      <ModelSettings state={state} busy={busy} mutate={mutate} />
    </section>
  );
}

const modelFields = [
  {
    key: "reasoningModel",
    label: "Analysis and writing model",
    fallback: "gemini-3.8-flash",
  },
  {
    key: "speechModel",
    label: "Speech model",
    fallback: "gemini-3.8-flash-lite-tts",
  },
  {
    key: "transcriptionModel",
    label: "Transcription model",
    fallback: "gemini-3.5-transcribe",
  },
  { key: "voice", label: "Narration voice", fallback: "Kore" },
] as const;
type ModelSetting = (typeof modelFields)[number]["key"];

function ModelSettings({
  state,
  busy,
  mutate,
}: Pick<ScreenProps, "state" | "busy" | "mutate">) {
  const [changes, setChanges] = useState<Partial<Record<ModelSetting, string>>>(
    {},
  );
  const [saved, setSaved] = useState(false);
  const currentValue = (field: (typeof modelFields)[number]) =>
    savedString(state.settings, field.key) || field.fallback;
  const value = (field: (typeof modelFields)[number]) =>
    changes[field.key] ?? currentValue(field);
  const dirty = modelFields.some(
    (field) => value(field).trim() !== currentValue(field),
  );
  const complete = modelFields.every((field) => value(field).trim().length > 0);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const patch = Object.fromEntries(
      modelFields
        .filter((field) => value(field).trim() !== currentValue(field))
        .map((field) => [field.key, value(field).trim()]),
    );
    if (await mutate("/api/settings", patch)) {
      setChanges({});
      setSaved(true);
    }
  };
  return (
    <details className="advanced-panel">
      <summary>Advanced · models and voice</summary>
      <form className="advanced-body form-stack" onSubmit={save}>
        <p className="field-hint">
          Use model IDs and a voice available to your Gemini account. Access and
          quota are checked when used.
        </p>
        {modelFields.map((field) => (
          <Field key={field.key} label={field.label}>
            <input
              required
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={value(field)}
              onChange={(event) => {
                setChanges((previous) => ({
                  ...previous,
                  [field.key]: event.target.value,
                }));
                setSaved(false);
              }}
            />
          </Field>
        ))}
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy || !dirty || !complete}
          >
            Save model settings
          </button>
          {saved && (
            <span className="saved-message" role="status">
              <Icon name="check" size={15} />
              Model settings saved
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

function AccessSettings({ state, busy, mutate }: ScreenProps) {
  const [password, setPassword] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate("/api/settings", { workbenchPassword: password }))
      setPassword("");
  };
  return (
    <section className="panel access-panel">
      <SectionHeading eyebrow="02 / YOUR WORKSPACE" title="Shared access" />
      <Badge
        tone={
          configured(state.settings, "workbenchPassword") ? "good" : "neutral"
        }
      >
        {configured(state.settings, "workbenchPassword")
          ? "Password enabled"
          : "Local access only"}
      </Badge>
      <p>
        Set a shared password before opening the studio through a public tunnel.
        Anyone you share it with can operate this workspace.
      </p>
      <form className="form-stack" onSubmit={save}>
        <Field
          label="Workbench password"
          hint="Saving a new password signs you out. Use the new password to return."
        >
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={200}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
        </Field>
        <button
          className="button secondary align-start"
          disabled={busy || password.length < 8}
        >
          {configured(state.settings, "workbenchPassword")
            ? "Change password"
            : "Set password"}
        </button>
      </form>
      <div className="setup-aside">
        <Icon name="star" size={22} />
        <p>
          The studio does the assembly.
          <br />
          You keep the final say.
        </p>
      </div>
    </section>
  );
}

function AccountSettings({ state, busy, mutate }: ScreenProps) {
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const value = (key: string) =>
    changes[key] ?? savedString(state.settings, key);
  const secret = (key: string) => changes[key] ?? "";
  const change = (key: string, next: string) => {
    setChanges((previous) => ({ ...previous, [key]: next }));
    setSaved(false);
  };
  const secrets = new Set([
    "instagramPassword",
    "instagramBirthday",
    "imapPassword",
    "imapAccessToken",
  ]);
  const dirty = Object.entries(changes).some(([key, next]) =>
    secrets.has(key)
      ? Boolean(next)
      : next !== String(state.settings[key] ?? ""),
  );
  const provider = value("emailProvider") || "mailtm";
  const mailbox = state.settings.mailtm as {
    address: string;
    provisioning: string;
  } | null;
  const signup = state.workspace.signup;
  const outcome = signup.outcome;
  const detailsSaved = Boolean(
    state.settings.instagramUsername &&
    state.settings.instagramDisplayName &&
    state.settings.instagramEmail &&
    configured(state.settings, "instagramPassword") &&
    configured(state.settings, "instagramBirthday"),
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const [key, next] of Object.entries(changes)) {
      if (secrets.has(key) && !next) continue;
      patch[key] = key === "imapPort" ? Number(next) : next;
    }
    if (await mutate("/api/settings", patch)) {
      setChanges({});
      setSaved(true);
    }
  };
  return (
    <section className="panel account-panel">
      <SectionHeading
        eyebrow="03 / YOUR PUBLISHING HOME"
        title="A fresh Instagram account"
      >
        <Badge
          tone={
            outcome?.status === "ready" ? "good" : outcome ? "warn" : "neutral"
          }
        >
          {outcome?.status === "ready"
            ? "Account ready"
            : outcome
              ? displayStatus(outcome.status)
              : "Not yet verified"}
        </Badge>
      </SectionHeading>
      <p className="section-note">
        Enter the intended owner's real details. The studio will attempt signup
        in a visible browser and pause if Instagram asks for your help.
      </p>
      <form className="form-stack" onSubmit={save}>
        <div className="form-grid">
          <Field label="Display name">
            <input
              maxLength={100}
              autoComplete="name"
              value={value("instagramDisplayName")}
              onChange={(event) =>
                change("instagramDisplayName", event.target.value)
              }
              placeholder="Your account name"
            />
          </Field>
          <Field label="Instagram username">
            <input
              maxLength={30}
              pattern="[a-zA-Z0-9_.]{1,30}"
              autoComplete="off"
              value={value("instagramUsername")}
              onChange={(event) =>
                change("instagramUsername", event.target.value)
              }
              placeholder="Choose a new username"
            />
          </Field>
          <Field
            label="Instagram password"
            hint={
              configured(state.settings, "instagramPassword")
                ? "A password is saved. Leave blank to keep it."
                : "Use a password for this new Instagram account."
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              maxLength={200}
              value={secret("instagramPassword")}
              onChange={(event) =>
                change("instagramPassword", event.target.value)
              }
              placeholder={
                configured(state.settings, "instagramPassword")
                  ? "Saved · enter a replacement to change"
                  : "Choose an account password"
              }
            />
          </Field>
          <Field
            label="Account owner's birthday"
            hint={
              configured(state.settings, "instagramBirthday")
                ? "Birthday saved privately. Leave blank to keep it."
                : "Use the account owner’s real date of birth."
            }
          >
            <input
              type="date"
              max={new Date().toLocaleDateString("en-CA")}
              value={secret("instagramBirthday")}
              onChange={(event) =>
                change("instagramBirthday", event.target.value)
              }
            />
          </Field>
        </div>
        <div className="inbox-section">
          <div className="inbox-heading">
            <div>
              <h3>Verification inbox</h3>
              <p>Give signup a place to receive its verification email.</p>
            </div>
            <div
              className="segmented compact-segmented"
              role="group"
              aria-label="Email provider"
            >
              <button
                type="button"
                className={provider === "mailtm" ? "selected" : ""}
                aria-pressed={provider === "mailtm"}
                onClick={() => change("emailProvider", "mailtm")}
              >
                Create an inbox
              </button>
              <button
                type="button"
                className={provider === "imap" ? "selected" : ""}
                aria-pressed={provider === "imap"}
                onClick={() => change("emailProvider", "imap")}
              >
                Use my inbox
              </button>
            </div>
          </div>
          {provider === "mailtm" ? (
            <div className="mailbox-card">
              <div>
                <strong>
                  {mailbox?.address ?? "A dedicated signup inbox"}
                </strong>
                <p>
                  {mailbox?.provisioning === "created"
                    ? "Inbox created. The studio can read matching verification emails."
                    : mailbox?.provisioning === "pending"
                      ? "Inbox provisioning needs to finish. Resume below."
                      : "Create an inbox without an API key. Instagram acceptance is checked during signup."}
                </p>
                <small>
                  Powered by{" "}
                  <a href="https://mail.tm" target="_blank" rel="noreferrer">
                    Mail.tm <Icon name="external" size={12} />
                  </a>
                </small>
              </div>
              <button
                type="button"
                className="button secondary small"
                disabled={busy || dirty || mailbox?.provisioning === "created"}
                onClick={() => void mutate("/api/account/inbox")}
              >
                {mailbox?.provisioning === "created" ? (
                  <>
                    <Icon name="check" size={15} />
                    Inbox ready
                  </>
                ) : mailbox ? (
                  "Verify inbox again"
                ) : (
                  "Create inbox"
                )}
              </button>
            </div>
          ) : (
            <div className="form-grid">
              <Field label="Email address">
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={value("instagramEmail")}
                  onChange={(event) =>
                    change("instagramEmail", event.target.value)
                  }
                  placeholder="An inbox you control"
                />
              </Field>
              <Field label="Mail server">
                <input
                  value={value("imapHost")}
                  onChange={(event) => change("imapHost", event.target.value)}
                  placeholder="imap.example.com"
                />
              </Field>
              <Field label="Mail username">
                <input
                  autoComplete="off"
                  value={value("imapUsername")}
                  onChange={(event) =>
                    change("imapUsername", event.target.value)
                  }
                  placeholder="Usually your email address"
                />
              </Field>
              <Field
                label="Mail password"
                hint={
                  configured(state.settings, "imapPassword")
                    ? "Password saved. Leave blank to keep it."
                    : "Your provider may require an app password."
                }
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={secret("imapPassword")}
                  onChange={(event) =>
                    change("imapPassword", event.target.value)
                  }
                  placeholder={
                    configured(state.settings, "imapPassword")
                      ? "Saved · enter a replacement to change"
                      : "Enter your mail password"
                  }
                />
              </Field>
              <details className="advanced-mail">
                <summary>Additional mail settings</summary>
                <div className="form-grid">
                  <Field label="Server port">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={
                        changes.imapPort ??
                        String(state.settings.imapPort ?? 993)
                      }
                      onChange={(event) =>
                        change("imapPort", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Mailbox">
                    <input
                      value={value("imapMailbox") || "INBOX"}
                      onChange={(event) =>
                        change("imapMailbox", event.target.value)
                      }
                    />
                  </Field>
                  <Field
                    label="Access token"
                    hint="Use this if your provider requires an OAuth access token."
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      value={secret("imapAccessToken")}
                      onChange={(event) =>
                        change("imapAccessToken", event.target.value)
                      }
                      placeholder={
                        configured(state.settings, "imapAccessToken")
                          ? "Saved · enter a replacement to change"
                          : "Optional"
                      }
                    />
                  </Field>
                </div>
              </details>
            </div>
          )}
        </div>
        <div className="button-row">
          <button className="button secondary" disabled={busy || !dirty}>
            Save account details
          </button>
          {dirty ? (
            <span className="field-hint">
              Save these changes before continuing.
            </span>
          ) : saved ? (
            <span className="saved-message" role="status">
              <Icon name="check" size={15} />
              Account details saved
            </span>
          ) : null}
        </div>
      </form>
      <div className="account-actions">
        <div className="account-status">
          <span
            className={`status-orb ${outcome?.status === "ready" ? "ready" : ""}`}
          >
            <Icon
              name={outcome?.status === "ready" ? "check" : "play"}
              size={22}
            />
          </span>
          <div>
            <h3>
              {outcome?.status === "ready"
                ? `@${outcome.username ?? savedString(state.settings, "instagramUsername")}`
                : signup.checkpoint
                  ? "Continue account setup"
                  : "Ready when you are"}
            </h3>
            <p>
              {outcome?.reason ??
                (outcome?.status === "ready"
                  ? "The configured account was observed in the browser. Check again before publishing if the session has changed."
                  : "Save the account details and prepare the inbox, then start signup.")}
            </p>
            {signup.checkpoint && (
              <small>
                Last saved step: {displayStatus(signup.checkpoint.phase)}
              </small>
            )}
          </div>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy || dirty || !state.settings.instagramUsername}
            onClick={() => void mutate("/api/account/readiness")}
          >
            Check account
          </button>
          {outcome?.status !== "ready" && (
            <button
              className="button primary"
              disabled={busy || dirty || !detailsSaved}
              onClick={() => void mutate("/api/account/signup")}
            >
              {signup.checkpoint ? "Resume signup" : "Create Instagram account"}
              <Icon name="arrow" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
