import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import styles from './LibraryUndoToast.module.css';

export function LibraryUndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = 8_000,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);
  useEffect(() => {
    if (paused) return undefined;
    const startedAt = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [onDismiss, paused]);
  return (
    <div
      className={styles.toast}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          onDismiss();
          onUndo();
        }}
      >
        {t('撤销')}
      </button>
      <button type="button" className={styles.close} aria-label={t('关闭')} onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
