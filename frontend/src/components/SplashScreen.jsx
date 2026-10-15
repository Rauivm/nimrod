import { useCallback, useEffect, useId, useRef, useState } from 'react';
import '../styles/splash.css';

const EMBLEM = '/splash/nimrod-elements.jpeg';
const ELEMENTS = [
  { name: 'Fogo', key: 'fire', color: '#e96820', end: '#ffd581', x: 0, y: 0,
    path: 'M -20 -20 C 170 10 120 230 330 240 S 380 440 500 500' },
  { name: 'Ar', key: 'air', color: '#93aab8', end: '#e3edf0', x: 1000, y: 0,
    path: 'M 1020 -20 C 780 40 950 250 740 310 S 650 490 500 500' },
  { name: 'Água', key: 'water', color: '#168ba8', end: '#97e4eb', x: 1000, y: 1000,
    path: 'M 1020 1020 C 770 1010 850 770 670 730 S 640 520 500 500' },
  { name: 'Terra', key: 'earth', color: '#78834d', end: '#d9ce8d', x: 0, y: 1000,
    path: 'M -20 1020 C 220 960 60 770 300 700 S 340 520 500 500' },
];

function ElementSpark({ kind }) {
  if (kind === 'fire') return <path d="M0 -13C8 -5 12 2 5 10C1 14 -8 9 -7 3C-6 -2 0 -3 0 -13Z" />;
  if (kind === 'water') return <><path d="M0 -12C3 -6 10 1 6 8C1 15 -9 8 -7 2Z" /><path d="M-3 2Q-5 6 -1 8" fill="none" stroke="#f2ffff" strokeWidth="1.5" /></>;
  if (kind === 'air') return <path d="M-16 3Q0 -10 13 -2Q21 4 10 7M-10 9Q1 1 9 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
  return <><path d="M-6 -8L4 -10L10 -1L5 8L-7 6L-10 -2Z" fill="#8c7751" /><path d="M-7 -4Q-17 -15 -23 -7Q-18 4 -7 -4Z" /><path d="M-18 -7L-7 -4" stroke="#dbe5ad" strokeWidth="1" /></>;
}

function ElementWeave() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="intro-weave" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        {ELEMENTS.map(element => <linearGradient key={element.key} id={`${id}-${element.key}`} gradientUnits="userSpaceOnUse"
          x1={element.x} y1={element.y} x2="500" y2="500">
          <stop stopColor={element.color} stopOpacity="0" />
          <stop offset=".18" stopColor={element.color} stopOpacity=".8" />
          <stop offset=".75" stopColor={element.color} />
          <stop offset="1" stopColor={element.end} />
        </linearGradient>)}
      </defs>
      {ELEMENTS.map((element, index) => <g key={element.key} style={{ '--stream-delay': `${index * .08}s`, color: element.color }}>
        <path className="intro-ribbon intro-ribbon-glow" d={element.path} pathLength="1" stroke={`url(#${id}-${element.key})`}
          filter={`url(#${id}-glow)`} />
        <path className="intro-ribbon" d={element.path} pathLength="1" stroke={`url(#${id}-${element.key})`} />
        <path className="intro-ribbon intro-ribbon-fine" d={element.path} pathLength="1" stroke={element.end} transform={`translate(${index % 2 ? -9 : 9} 8)`} />
        {Array.from({ length: 9 }, (_, particle) => {
          const begin = `${(.1 + index * .08 + particle * .075).toFixed(3)}s`;
          const duration = `${(2.3 - particle * .045).toFixed(3)}s`;
          return <g key={particle} opacity="0" fill={element.color}>
            <animateMotion path={element.path} dur={duration} begin={begin} rotate="auto" fill="freeze"
              calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines=".4 0 .3 1" />
            <animate attributeName="opacity" values="0;.85;.9;0" keyTimes="0;.12;.78;1" dur={duration} begin={begin} fill="freeze" />
            <g transform={`scale(${.45 + (particle % 3) * .2})`}><ElementSpark kind={element.key} /></g>
          </g>;
        })}
      </g>)}
    </svg>
  );
}

export default function SplashScreen({ onDone }) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [exiting, setExiting] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const onDoneRef = useRef(onDone);
  const completed = useRef(false);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = event => setReducedMotion(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    setExiting(false);
    const leave = window.setTimeout(() => setExiting(true), reducedMotion ? 1500 : 5050);
    const deadline = window.setTimeout(finish, reducedMotion ? 1800 : 5600);
    const escape = event => { if (event.key === 'Escape') finish(); };
    window.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(deadline);
      window.removeEventListener('keydown', escape);
    };
  }, [finish, reducedMotion]);

  return (
    <section className={`nimrod-splash${exiting ? ' is-exiting' : ''}`} data-reduced-motion={reducedMotion}
      aria-label="Abertura do Nimrod">
      <div className="intro-paper" aria-hidden="true" />
      {!reducedMotion && <>
        <div className="intro-aura intro-aura-fire" aria-hidden="true" />
        <div className="intro-aura intro-aura-air" aria-hidden="true" />
        <div className="intro-aura intro-aura-water" aria-hidden="true" />
        <div className="intro-aura intro-aura-earth" aria-hidden="true" />
        <ElementWeave />
        <div className="intro-convergence" aria-hidden="true" />
        <div className="intro-shockwave" aria-hidden="true" />
      </>}
      <span className="intro-wordmark" aria-hidden="true">Nimrod</span>
      <button className="intro-skip" onClick={finish}>Pular abertura <span aria-hidden="true">↗</span></button>
      <div className="intro-corners" aria-hidden="true">
        {ELEMENTS.map(element => <div key={element.key} className={`intro-corner intro-corner-${element.key}`}>
          <i /><span>{element.name}</span>
        </div>)}
      </div>
      <div className="intro-altar">
        <div className="intro-art">
          {(!imageLoaded || imageFailed) && <span className="intro-image-fallback" aria-hidden="true">NIMROD</span>}
          {!reducedMotion && !imageFailed && ELEMENTS.map(element => <img key={element.key} src={EMBLEM} alt="" aria-hidden="true"
            className={`intro-piece intro-piece-${element.key}`} draggable="false" />)}
          {!imageFailed && <img className="intro-emblem" src={EMBLEM} alt="Símbolo do Nimrod reunindo fogo, ar, água e terra."
            fetchpriority="high" decoding="async" draggable="false" onLoad={() => setImageLoaded(true)} onError={() => setImageFailed(true)} />}
        </div>
      </div>
      <footer className="intro-caption">
        <div className="intro-caption-rule" aria-hidden="true"><i /><span>O encontro dos elementos</span><i /></div>
        <p>Um mundo. Infinitas histórias.</p>
      </footer>
    </section>
  );
}
