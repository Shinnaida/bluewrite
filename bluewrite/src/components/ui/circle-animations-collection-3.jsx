import React, { useEffect, useRef } from 'react';

// Orbiting golden segments around the folder, adapted from Spiral Galaxy.
export default function SpiralGalaxy({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const size = 180;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Extra transparent drawing room prevents the long lines being clipped.
    canvas.width = size * 2 * dpr;
    canvas.height = size * 2 * dpr;
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    const centimetre = 96 / 2.54;
    let displayWidth = canvas.getBoundingClientRect().width / 2 || 57.5;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Only the two outer rings; preserve their original speed and thickness.
    const rings = [
      { radius: 60, count: 2, index: 3 },
      { radius: 75, count: 3, index: 4, lengthCm: 0.9 },
    ];
    let frame = 0;
    let time = 0;
    let lastTime = null;

    // Constant-radius curves orbit the folder without spiraling outward.
    const dash = (radius, angle, opacity, span, thickness) => {
      ctx.beginPath();
      for (let step = 0; step <= 64; step++) {
        const offset = (step / 64 - 0.5) * span;
        const x = 90 + Math.cos(angle + offset) * radius;
        const y = 90 + Math.sin(angle + offset) * radius;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(245, 183, 36, ${opacity})`;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      // One pass preserves the 70% stroke alpha instead of stacking it twice.
      // The halo has its own 50% alpha, without affecting the blue disc.
      ctx.shadowColor = 'rgba(245, 183, 36, 0.5)';
      ctx.shadowBlur = 8 * dpr;
      ctx.stroke();
    };
    const draw = () => {
      ctx.clearRect(-size / 2, -size / 2, size * 2, size * 2);
      rings.forEach(ring => {
        const { index } = ring;
        const speed = 0.2 + index * 0.03;
        // Keep the inner gap; the outer ring uses three 0.6 CSS cm curves.
        const widths = [0, 1].map(i => 4.5 + ((i * 7 + index * 3) % 5) * 0.375);
        const endpointGap = centimetre * 0.2 * size / displayWidth + (widths[0] + widths[1]) / 2;
        const span = ring.lengthCm
          ? ring.lengthCm * centimetre * size / (displayWidth * ring.radius)
          : 2 * Math.acos(Math.min(1, endpointGap / (2 * ring.radius)));
        for (let i = 0; i < ring.count; i++) {
          const angle = (i / ring.count) * Math.PI * 2 + time * speed + (ring.radius / 15) * 0.4;
          // Evenly spaced orbit segments leave open space around the folder.
          const radius = ring.radius;
          const opacity = 0.7;
          // Stable variation per stroke: no random flicker as the spiral turns.
          const variation = (i * 7 + index * 3) % 5;
          const thickness = 4.5 + variation * 0.375;
          dash(radius, angle, opacity, span, thickness);
        }
      });
    };
    const animate = timestamp => {
      if (lastTime !== null) time += Math.min(timestamp - lastTime, 50) * 0.001;
      lastTime = timestamp;
      draw();
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      lastTime = null;
      draw();
      if (!motion.matches && !document.hidden) frame = requestAnimationFrame(animate);
    };
    const resizeObserver = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width / 2;
      if (width > 0) displayWidth = width;
      draw();
    });
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    resizeObserver.observe(canvas);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <span className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="spiral-galaxy-canvas" aria-hidden="true" />
    </span>
  );
}
