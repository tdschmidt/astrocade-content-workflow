import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "../shared/domain.js";
import type { Job } from "../server/jobs.js";

export type WorkbenchState = {
  workspace: Workspace;
  jobs: Job[];
  settings: Record<string, unknown>;
  busy: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`,
      response.status,
    );
  return data as T;
}

export function useWorkbench() {
  const [state, setState] = useState<WorkbenchState>();
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const sequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    try {
      const data = await request<WorkbenchState>(
        "/api/state",
        undefined,
        signal,
      );
      if (current === sequence.current) {
        setState(data);
        setLocked(false);
      }
      return data;
    } catch (cause) {
      if (signal?.aborted || current !== sequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) setLocked(true);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "The workspace could not be reached.",
        );
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(abort.signal);
      if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  const mutate = useCallback(
    async (path: string, body: unknown = {}): Promise<boolean> => {
      setPendingCount((count) => count + 1);
      setError("");
      try {
        const result = await request<{ job?: Job }>(path, body);
        const shortMutation =
          path === "/api/settings" ||
          path === "/api/profiles" ||
          path.endsWith("/approve");
        if (shortMutation && result.job) {
          // Preserve unsaved form values until the queued write actually completes.
          for (let attempt = 0; attempt < 40; attempt++) {
            const snapshot = await refresh();
            const job = snapshot?.jobs.find(
              (item) => item.id === result.job!.id,
            );
            if (job && job.status !== "running") {
              if (job.status !== "completed")
                throw new Error(job.error ?? job.step);
              return true;
            }
            // A successful password change deliberately invalidates this session.
            if (
              !snapshot &&
              path === "/api/settings" &&
              typeof body === "object" &&
              body !== null &&
              "workbenchPassword" in body
            )
              return true;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          throw new Error(
            "The save is still being checked. Your form values have been kept; check the operation status before retrying.",
          );
        }
        await refresh();
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) setLocked(true);
        setError(
          cause instanceof Error
            ? cause.message
            : "The action could not be completed.",
        );
        return false;
      } finally {
        setPendingCount((count) => count - 1);
      }
    },
    [refresh],
  );
  return {
    state,
    error,
    setError,
    locked,
    pending: pendingCount > 0,
    mutate,
    refresh,
  };
}
