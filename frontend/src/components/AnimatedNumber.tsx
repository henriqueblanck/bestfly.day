import { useState, useEffect, useRef } from "react";

interface Props {
  value: number;
  duration?: number;
  from?: number;
  format?: (n: number) => string;
}

export function AnimatedNumber({
  value,
  duration = 800,
  from = 0,
  format = (n) => n.toLocaleString("pt-BR"),
}: Props) {
  const [display, setDisplay] = useState(from);
  const rafRef = useRef<number>(0);
  const prevRef = useRef(from);

  useEffect(() => {
    const startVal = prevRef.current;
    prevRef.current = value;
    let startTime = 0;
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(startVal + (value - startVal) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <>{format(display)}</>;
}
