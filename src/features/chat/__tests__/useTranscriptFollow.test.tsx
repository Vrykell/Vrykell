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
    fireEvent.scroll(body);
    act(() => vi.advanceTimersByTime(200));
    expect(body.scrollTop).toBe(300);
    expect(follow!.following).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('ignores small wheel movement and immediately hides the button when scrolled back to the bottom', () => {
  let follow: ReturnType<typeof useTranscriptFollow>;
  function Transcript({ revision = 0 }: { revision?: number }) {
    follow = useTranscriptFollow('threshold', revision);
    return <div data-testid="threshold" ref={follow.scrollRef} onScroll={follow.onScroll} onWheel={follow.onWheel} />;
  }
  const view = render(<Transcript />);
  const body = screen.getByTestId('threshold');
  let height = 1000;
  Object.defineProperties(body, { scrollHeight: { get: () => height }, clientHeight: { value: 200 } });
  body.scrollTop = 800; fireEvent.scroll(body);
  fireEvent.wheel(body, { deltaY: -18 });
  body.scrollTop = 782; fireEvent.scroll(body);
  expect(follow!.following).toBe(true);
  height = 1010; view.rerender(<Transcript revision={1} />);
  expect(body.scrollTop).toBe(782);
  body.scrollTop = 700; fireEvent.scroll(body);
  expect(follow!.following).toBe(false);
  body.scrollTop = 810; fireEvent.scroll(body);
  expect(follow!.following).toBe(true);
  fireEvent.scroll(body);
  expect(follow!.following).toBe(true);
  height = 1100; view.rerender(<Transcript revision={2} />);
  expect(body.scrollTop).toBe(1100);
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
