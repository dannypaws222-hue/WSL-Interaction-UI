import type { ReactNode } from 'react';
import type { PollSnapshot } from '../api/types';

export interface SnapshotCardProps<T> {
  title: string;
  snapshot: PollSnapshot<T> | null;
  renderData: (data: T) => ReactNode;
}

export function SnapshotCard<T>({ title, snapshot, renderData }: SnapshotCardProps<T>) {
  if (!snapshot || (snapshot.data === null && !snapshot.lastError)) {
    return (
      <section aria-label={title}>
        <h2>{title}</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (snapshot.data === null) {
    return (
      <section aria-label={title}>
        <h2>{title}</h2>
        <p role="alert">{snapshot.lastError}</p>
      </section>
    );
  }

  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {snapshot.isStale && (
        <p role="alert">Stale data{snapshot.lastError ? `: ${snapshot.lastError}` : ''}</p>
      )}
      {renderData(snapshot.data)}
      {snapshot.lastSuccessAt && (
        <p>Updated {new Date(snapshot.lastSuccessAt).toLocaleTimeString()}</p>
      )}
    </section>
  );
}
