import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryUndoToast } from './LibraryUndoToast';

afterEach(() => {
  vi.useRealTimers();
});

describe('LibraryUndoToast', () => {
  it('runs the undo action and dismisses itself', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<LibraryUndoToast message="已移除标签" onUndo={onUndo} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <LibraryUndoToast
        message="已移除标签"
        durationMs={1_000}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
