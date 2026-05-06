import { useEffect, useState, useRef } from 'react';

const FRAMES = [
  '/splash/f0.jpg',
  '/splash/f1.jpg',
  '/splash/f2.jpg',
  '/splash/f3.jpg',
  '/splash/f4.jpg',
  '/splash/f2.jpg',
  '/splash/f0.jpg',
];

// "Éter" → "Ar" as required
const ELEMENT_LABELS = ['', 'Fogo', 'Água', 'Terra', 'Ar', '', ''];

const FRAME_DURATION = 520;
const FADE_DURATION  = 380;

export default function SplashScreen({ onDone }) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [nextFrame, setNextFrame]       = useState(1);
  const [fading, setFading]             = useState(false);
  const [phase, setPhase]               = useState('enter');
  const [titleVisible, setTitleVisible] = useState(false);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [elementLabel, setElementLabel] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => {
    FRAMES.forEach(src => { const img = new window.Image(); img.src = src; });
  }, []);

  useEffect(() => {
    const fallback = setTimeout(() => {
      onDone?.();
    }, 5000);

    return () => clearTimeout(fallback);
  }, [onDone]);

  useEffect(() => {
    const t1 = setTimeout(() => setTitleVisible(true),    300);
    const t2 = setTimeout(() => setSubtitleVisible(true), 800);
    const t3 = setTimeout(() => setPhase('run'),         1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    if (phase !== 'run') return;
    let idx = 0;
    intervalRef.current = setInterval(() => {
      idx++;
      const next = idx % FRAMES.length;
      setElementLabel(ELEMENT_LABELS[next] || '');
      setFading(true);
      setNextFrame(next);
      setTimeout(() => { setCurrentFrame(next); setFading(false); }, FADE_DURATION);
      if (idx >= FRAMES.length - 1) {
        clearInterval(intervalRef.current);
        setTimeout(() => { setPhase('exit'); setTimeout(() => onDone?.(), 600); }, FRAME_DURATION + 200);
      }
    }, FRAME_DURATION + FADE_DURATION);
    return () => clearInterval(intervalRef.current);
  }, [phase, onDone]);

  return (
    <div className={`splash-root ${phase === 'exit' ? 'splash-exit' : ''}`}>
      <div className="splash-bg" />
      <div className="splash-stars">
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} className="splash-star" style={{
            left: `${Math.random() * 100}%`,
            top:  `${Math.random() * 100}%`,
            '--delay': `${(Math.random() * 3).toFixed(2)}s`,
            '--size':  `${1 + Math.random() * 2}px`,
          }} />
        ))}
      </div>

      <div className="splash-center">
        <div className="splash-ring splash-ring-outer" />
        <div className="splash-ring splash-ring-inner" />

        <div className="splash-orb">
          <img src={FRAMES[currentFrame]} className="splash-img splash-img-current" style={{ opacity: fading ? 0 : 1 }} alt="" />
          <img src={FRAMES[nextFrame]}    className="splash-img splash-img-next"    style={{ opacity: fading ? 1 : 0 }} alt="" />
          <div className="splash-orb-vignette" />
        </div>

        <div className={`splash-element ${elementLabel ? 'splash-element-visible' : ''}`}>
          {elementLabel}
        </div>

        <div className={`splash-title-block ${titleVisible ? 'splash-title-in' : ''}`}>
          <div className="splash-eyebrow">⚔ · · ·</div>
          <h1 className="splash-title">NIMROD</h1>
          <div className="splash-subtitle-line" />
          <div className={`splash-subtitle ${subtitleVisible ? 'splash-subtitle-in' : ''}`}>
            Foundry VTT · Plataforma de Aventureiros
          </div>
        </div>

        <div className={`splash-dots ${subtitleVisible ? 'splash-dots-in' : ''}`}>
          <span /><span /><span />
        </div>
      </div>

      <style>{`
        .splash-root { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: #02010a; transition: opacity 0.6s ease, transform 0.6s ease; }
        .splash-exit { opacity: 0; transform: scale(1.04); pointer-events: none; }
        .splash-bg { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 20%, rgba(255,80,0,0.08) 0%, transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(0,120,255,0.10) 0%, transparent 55%), linear-gradient(160deg, #040212 0%, #02010a 50%, #040212 100%); animation: bgPulse 8s ease-in-out infinite alternate; }
        @keyframes bgPulse { 0% { opacity: 0.8; } 100% { opacity: 1; } }
        .splash-stars { position: absolute; inset: 0; overflow: hidden; }
        .splash-star { position: absolute; width: var(--size); height: var(--size); border-radius: 50%; background: white; animation: twinkle 3s var(--delay) ease-in-out infinite alternate; opacity: 0.4; }
        @keyframes twinkle { 0% { opacity: 0.1; transform: scale(0.8); } 100% { opacity: 0.9; transform: scale(1.2); } }
        .splash-center { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0; }
        .splash-ring { position: absolute; border-radius: 50%; border: 1px solid transparent; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; }
        .splash-ring-outer { width: 320px; height: 320px; border-color: rgba(255,140,0,0.25); box-shadow: 0 0 40px rgba(255,140,0,0.12); animation: ringRotate 12s linear infinite; }
        .splash-ring-inner { width: 276px; height: 276px; border-color: rgba(0,160,255,0.2); box-shadow: 0 0 30px rgba(0,160,255,0.10); animation: ringRotate 8s linear infinite reverse; }
        @keyframes ringRotate { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
        .splash-orb { position: relative; width: 260px; height: 260px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 3px rgba(255,140,0,0.3), 0 0 60px rgba(255,100,0,0.25), 0 20px 80px rgba(0,0,0,0.8); animation: orbFloat 6s ease-in-out infinite; flex-shrink: 0; }
        @keyframes orbFloat { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
        .splash-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity ${FADE_DURATION}ms ease-in-out; border-radius: 50%; }
        .splash-img-current { z-index: 1; }
        .splash-img-next    { z-index: 2; }
        .splash-orb-vignette { position: absolute; inset: 0; z-index: 3; border-radius: 50%; background: radial-gradient(circle at center, transparent 55%, rgba(2,1,10,0.45) 100%); pointer-events: none; }
        .splash-element { height: 22px; margin-top: 14px; font-family: 'Cinzel', serif; font-size: 11px; font-weight: 600; letter-spacing: 4px; text-transform: uppercase; color: rgba(201,168,76,0.0); transition: color 0.3s ease, opacity 0.3s ease; opacity: 0; }
        .splash-element-visible { color: rgba(201,168,76,0.85); opacity: 1; }
        .splash-title-block { margin-top: 28px; text-align: center; opacity: 0; transform: translateY(20px); transition: opacity 0.7s ease, transform 0.7s ease; }
        .splash-title-in { opacity: 1; transform: translateY(0); }
        .splash-eyebrow { font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 6px; color: rgba(201,168,76,0.5); margin-bottom: 10px; }
        .splash-title { font-family: 'Cinzel', serif; font-size: clamp(42px, 8vw, 72px); font-weight: 900; letter-spacing: 18px; color: transparent; background: linear-gradient(160deg, #f5d080 0%, #e8a840 30%, #fff5cc 50%, #c98020 70%, #f0c060 100%); background-clip: text; -webkit-background-clip: text; filter: drop-shadow(0 0 30px rgba(201,140,30,0.6)) drop-shadow(0 2px 6px rgba(0,0,0,0.9)); margin: 0; line-height: 1; }
        .splash-subtitle-line { width: 120px; height: 1px; margin: 14px auto 12px; background: linear-gradient(90deg, transparent, rgba(201,168,76,0.5), transparent); }
        .splash-subtitle { font-family: 'Crimson Pro', serif; font-size: 13px; letter-spacing: 2px; color: rgba(200,180,130,0); font-style: italic; transition: color 0.7s ease 0.3s; }
        .splash-subtitle-in { color: rgba(200,180,130,0.7); }
        .splash-dots { display: flex; gap: 6px; margin-top: 28px; opacity: 0; transition: opacity 0.5s ease 0.5s; }
        .splash-dots-in { opacity: 1; }
        .splash-dots span { width: 5px; height: 5px; border-radius: 50%; background: rgba(201,168,76,0.5); animation: dotPulse 1.4s ease-in-out infinite; }
        .splash-dots span:nth-child(2) { animation-delay: 0.2s; }
        .splash-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotPulse { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; } 40% { transform: scale(1.2); opacity: 1; } }
      `}</style>
    </div>
  );
}
