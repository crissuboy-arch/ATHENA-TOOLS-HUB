"use client";

import { eventMessage, formatDateTime, shortId, type JobEvent } from "@/lib/workflow-models";

/** Vertical timeline of real job events (newest last). */
export default function JobTimeline({ events }: { events: JobEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-ink-500 [.dark_&]:text-ink-300">
        Nenhum evento registrado para esta tarefa ainda.
      </p>
    );
  }

  return (
    <ol className="relative space-y-6 border-l-2 border-ink-100 pl-6 [.dark_&]:border-navy-700">
      {events.map((ev) => {
        const message = eventMessage(ev);
        const transition =
          ev.fromStatus || ev.toStatus ? `${ev.fromStatus ?? "?"} → ${ev.toStatus ?? "?"}` : null;
        return (
          <li key={ev.id} className="relative">
            <span
              className="absolute top-1 -left-[31px] h-3 w-3 rounded-full border-2 border-gold-500 bg-white [.dark_&]:bg-navy-900"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <time className="text-xs text-ink-500 [.dark_&]:text-ink-300">
                {formatDateTime(ev.createdAt)}
              </time>
              <span className="rounded bg-mist px-1.5 py-0.5 font-mono text-[11px] text-ink-700 [.dark_&]:bg-navy-800 [.dark_&]:text-ink-100">
                {ev.type}
              </span>
              {transition ? (
                <span className="text-xs font-medium text-ink-500 [.dark_&]:text-ink-300">
                  {transition}
                </span>
              ) : null}
              {ev.actorId ? (
                <span className="text-xs text-ink-500 [.dark_&]:text-ink-300">
                  por {ev.actorType || "ator"} {shortId(ev.actorId)}
                </span>
              ) : null}
            </div>
            {message ? (
              <p className="mt-1 text-sm text-ink-900 [.dark_&]:text-ink-100">{message}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
