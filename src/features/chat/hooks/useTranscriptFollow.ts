import { useLayoutEffect, useRef, useState, type UIEvent, type WheelEvent } from 'react';

const SHOW_LATEST_DISTANCE = 64;
const RESUME_LATEST_DISTANCE = 12;

function innerScrollerHoldsUpward(target: EventTarget, root: HTMLElement): boolean {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== root; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollTop > 0) return true;
  }
  return false;
}

/** Retain reading positions and follow streamed changes only while the reader allows it. */
export function useTranscriptFollow(id: string, revision: unknown, active = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const lastTop = useRef(0);
  const positions = useRef(new Map<string, { top: number; following: boolean }>());
  const syncLatestButton = (scroll: HTMLDivElement) => {
    if (scroll.clientHeight <= 0) return Number.POSITIVE_INFINITY;
    const distance = Math.max(0, scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight);
    setFollowing(current => distance <= RESUME_LATEST_DISTANCE ? true : distance >= SHOW_LATEST_DISTANCE ? false : current);
    return distance;
  };
  const pauseFollow = () => { followRef.current = false; if (scrollRef.current) syncLatestButton(scrollRef.current); };
  const jumpToLatest = () => {
    followRef.current = true;
    setFollowing(true);
    if (scrollRef.current && active) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastTop.current = scrollRef.current.scrollTop;
    }
  };
  useLayoutEffect(() => {
    if (!active || !scrollRef.current) return;
    const saved = positions.current.get(id);
    followRef.current = saved?.following ?? true;
    setFollowing(followRef.current);
    const apply = () => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTop = saved?.following === false ? saved.top : scrollRef.current.scrollHeight;
      lastTop.current = scrollRef.current.scrollTop;
      if (syncLatestButton(scrollRef.current) <= RESUME_LATEST_DISTANCE) followRef.current = true;
    };
    apply();
    // A parked host has no layout box, so re-apply the position once it is attached again.
    const frame = saved ? requestAnimationFrame(apply) : undefined;
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      positions.current.set(id, { top: lastTop.current, following: followRef.current });
    };
  }, [id, active]);
  useLayoutEffect(() => {
    if (active && scrollRef.current) {
      if (followRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        lastTop.current = scrollRef.current.scrollTop;
      }
      syncLatestButton(scrollRef.current);
    }
  }, [revision, active]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!active) return;
    const scroll = event.currentTarget;
    const ours = Math.abs(scroll.scrollTop - lastTop.current) <= 1;
    lastTop.current = scroll.scrollTop;
    if (syncLatestButton(scroll) <= RESUME_LATEST_DISTANCE) { followRef.current = true; return; }
    if (!ours) followRef.current = false;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0 && !innerScrollerHoldsUpward(event.target, event.currentTarget)) pauseFollow();
  };
  return { scrollRef, following, pauseFollow, jumpToLatest, onScroll, onWheel, onTouchMove: pauseFollow };
}
