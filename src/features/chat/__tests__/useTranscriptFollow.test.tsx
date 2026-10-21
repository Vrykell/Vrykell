import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useTranscriptFollow } from '../hooks/useTranscriptFollow';

it('cancels a pending return to latest when the reader pauses to inspect content', () => {
  vi.useFakeTimers();
  try {
    let follow: ReturnType<typeof useTranscriptFollow>;
    function Transcript() {
      follow = useTranscriptFollow('reading', 0);
      return <div data-testid="reading" ref={follow.scrollRef} onScroll={follow.onScroll} />;
    }
    render(<Transcript />);
    const body = screen.getByTestId('reading');
    Object.defineProperties(body, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
    body.scrollTop = 800; fireEvent.scroll(body);
    act(() => follow!.pauseFollow());
    body.scrollTop = 300;
    act(() => vi.advanceTimersByTime(200));
    expect(body.scrollTop).toBe(300);
    expect(follow!.following).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('follows incremental output while retaining a paused reading position across hidden pages', () => {
  let follow: ReturnType<typeof useTranscriptFollow>;
  function Transcript({ revision, active = true }: { revision: number; active?: boolean }) {
    follow = useTranscriptFollow('session', revision, active);
    return <div data-testid="transcript" ref={follow.scrollRef} onScroll={follow.onScroll} onWheel={follow.onWheel} />;
  }
  const view = render(<Transcript revision={0} />);
  const body = screen.getByTestId('transcript');
  let height = 1000;
  Object.defineProperties(body, { scrollHeight: { get: () => height }, clientHeight: { get: () => 200 } });
  view.rerender(<Transcript revision={1} />);
  expect(body.scrollTop).toBe(1000);
  body.scrollTop = 300;
  fireEvent.scroll(body);
  height = 1200;
  view.rerender(<Transcript revision={2} />);
  expect(body.scrollTop).toBe(300);
  expect(follow!.following).toBe(false);
  view.rerender(<Transcript revision={2} active={false} />);
  body.scrollTop = 0;
  fireEvent.scroll(body);
  view.rerender(<Transcript revision={3} />);
  expect(body.scrollTop).toBe(300);
  act(() => follow!.jumpToLatest());
  expect(body.scrollTop).toBe(1200);
  expect(follow!.following).toBe(true);
});
