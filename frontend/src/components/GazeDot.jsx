import { useEffect, useRef } from 'react';

export default function GazeDot({ x, y, visible = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || x == null || y == null) return;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }, [x, y]);
  if (!visible) return null;
  return <div ref={ref} className="gaze-dot" aria-hidden />;
}
