"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download, FileText, Info } from "lucide-react";
import clsx from "clsx";
import { Source } from "../lib/api";

const staleAfterMonths = 12;

function monthsSince(iso: string): number {
  const elapsed = Date.now() - Date.parse(iso);
  return Math.floor(elapsed / (1000 * 60 * 60 * 24 * 30));
}

/** "Section 4.2 · p.12" with fallbacks: page range only, then chunk ordinal. */
function sourceDetail(source: Source): string {
  const parts: string[] = [];
  if (source.section) {
    parts.push(source.section);
  }
  if (source.page !== null) {
    parts.push(
      source.page_end !== null && source.page_end !== source.page
        ? `pp.${source.page}–${source.page_end}`
        : `p.${source.page}`
    );
  }
  if (parts.length === 0) {
    parts.push(`Chunk ${source.id}`);
  }
  return parts.join(" · ");
}

function sourceAnchorId(messageIndex: number, sourceId: number): string {
  return `msg-${messageIndex}-source-${sourceId}`;
}

export function AnswerWithSources({
  content,
  sources,
  grounded,
  messageIndex,
  onDownload
}: {
  content: string;
  sources: Source[];
  grounded: boolean;
  messageIndex: number;
  onDownload: (documentId: string, filename: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const sourceIds = useMemo(() => new Set(sources.map((source) => source.id)), [sources]);

  const groups = useMemo(() => {
    const byDocument = new Map<string, { document: string; last_updated: string | null; items: Source[] }>();
    for (const source of sources) {
      const group = byDocument.get(source.documentId);
      if (group) {
        group.items.push(source);
      } else {
        byDocument.set(source.documentId, {
          document: source.document,
          last_updated: source.last_updated,
          items: [source]
        });
      }
    }
    return [...byDocument.entries()].map(([documentId, group]) => ({ documentId, ...group }));
  }, [sources]);

  function jumpToSource(id: number) {
    setExpanded(true);
    setHighlighted(id);
    // Wait a tick so the panel is open before scrolling.
    requestAnimationFrame(() => {
      document
        .getElementById(sourceAnchorId(messageIndex, id))
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  // Split the answer on [n] markers; markers matching a real source become chips.
  const segments = content.split(/(\[\d+\])/g);

  return (
    <div>
      <p className="whitespace-pre-wrap">
        {segments.map((segment, index) => {
          const match = segment.match(/^\[(\d+)\]$/);
          const id = match ? Number(match[1]) : null;
          if (id !== null && sourceIds.has(id)) {
            return (
              <button
                key={index}
                type="button"
                onClick={() => jumpToSource(id)}
                title={`View source ${id}`}
                className="mx-0.5 inline-flex h-4 -translate-y-1 items-center rounded bg-accent/10 px-1 align-baseline text-[11px] font-semibold text-accent hover:bg-accent/20"
              >
                {id}
              </button>
            );
          }
          return <span key={index}>{segment}</span>;
        })}
      </p>

      {sources.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            <ChevronDown
              className={clsx("h-3.5 w-3.5 transition-transform", !expanded && "-rotate-90")}
              aria-hidden="true"
            />
            Sources ({sources.length})
          </button>

          {expanded ? (
            <div className="mt-2 space-y-2">
              {groups.map((group) => {
                const stale =
                  group.last_updated !== null && monthsSince(group.last_updated) >= staleAfterMonths;
                return (
                  <div key={group.documentId} className="rounded border border-line bg-white">
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                        <span className="truncate text-xs font-semibold text-ink">
                          {group.document}
                        </span>
                        {stale && group.last_updated ? (
                          <span className="flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Last updated {monthsSince(group.last_updated)} months ago
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDownload(group.documentId, group.document)}
                        title={`Download ${group.document}`}
                        className="flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-accent"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        Open
                      </button>
                    </div>
                    <ul className="divide-y divide-line">
                      {group.items.map((source) => (
                        <li
                          key={source.id}
                          id={sourceAnchorId(messageIndex, source.id)}
                          className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 text-xs text-muted transition-colors",
                            highlighted === source.id && "bg-accent/5"
                          )}
                        >
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-accent/10 text-[10px] font-semibold text-accent">
                            {source.id}
                          </span>
                          <span className="truncate">{sourceDetail(source)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : !grounded ? (
        <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          No sources — this reply is not grounded in company documents.
        </div>
      ) : null}
    </div>
  );
}
