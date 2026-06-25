import type { SourceSummary } from '../lib/aggregate';

interface Props {
  sources: SourceSummary[];
}

export default function Sources({ sources }: Props) {
  if (sources.length === 0) {
    return <p className="muted">No statements imported yet.</p>;
  }

  return (
    <ul className="sources">
      {sources.map((s) => (
        <li key={s.source} className="source">
          <span className="source-icon" aria-hidden>
            ▤
          </span>
          <div className="source-meta">
            <span className="source-name" title={s.source}>
              {s.source}
            </span>
            <span className="source-sub">
              {s.count} transactions · {s.firstDate} → {s.lastDate}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
