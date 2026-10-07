import type { ReactNode } from "react";
import type { WorkbenchState } from "./api.js";

export type Screen = "studio" | "research" | "setup";
export type ScreenProps = {
  state: WorkbenchState;
  busy: boolean;
  mutate: (path: string, body?: unknown) => Promise<boolean>;
  navigate: (screen: Screen) => void;
};

export function Icon({
  name,
  size = 18,
}: {
  name:
    | "star"
    | "play"
    | "search"
    | "settings"
    | "arrow"
    | "check"
    | "external"
    | "plus";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    star: (
      <>
        <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z" />
        <path d="m19 2 .5 2.5L22 5l-2.5.5L19 8l-.5-2.5L16 5l2.5-.5Z" />
      </>
    ),
    play: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m10 8 6 4-6 4Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    external: (
      <>
        <path d="M14 3h7v7M21 3 10 14" />
        <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <Icon name="star" size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export function mediaUrl(path: string) {
  return `/media/${encodeURIComponent(path.split(/[\\/]/).at(-1) ?? "")}`;
}

export function displayStatus(status: string) {
  return status.replaceAll("_", " ").replaceAll("-", " ");
}
