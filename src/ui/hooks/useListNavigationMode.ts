import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export function useListNavigationMode(initialKeyboard = false) {
  const [keyboardNavigation, setKeyboardNavigation] = useState(initialKeyboard);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pointerMoved = useRef(false);
  const onPointerMoveCapture = (event: PointerEvent<HTMLElement>) => {
    pointerMoved.current = !pointer.current || pointer.current.x !== event.clientX || pointer.current.y !== event.clientY;
    pointer.current = { x: event.clientX, y: event.clientY };
    if (pointerMoved.current) setKeyboardNavigation(false);
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (!['Shift', 'Control', 'Meta', 'Alt', 'CapsLock'].includes(event.key)) setKeyboardNavigation(true);
  };
  const onPointerLeave = () => { pointer.current = null; pointerMoved.current = false; };
  return {
    keyboardNavigation, setKeyboardNavigation, pointerMoved,
    props: { 'data-list-navigation': true, 'data-keyboard-navigation': keyboardNavigation, onPointerMoveCapture, onPointerLeave, onKeyDownCapture },
  };
}
