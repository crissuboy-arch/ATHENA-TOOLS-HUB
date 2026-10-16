import * as React from "react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  caption?: string;
  emptyMessage?: string;
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  caption,
  emptyMessage = "Nenhum registro.",
  className = "",
}: TableProps<T>) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-ink-100 ${className}`}>
      <table className="w-full min-w-[480px] border-collapse bg-paper text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink-100 bg-mist">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500 ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-ink-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={getRowKey(row, i)}
                className="border-b border-ink-100 last:border-0 hover:bg-mist/60"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-ink-700 ${col.className ?? ""}`}
                  >
                    {col.render
                      ? col.render(row)
                      : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
