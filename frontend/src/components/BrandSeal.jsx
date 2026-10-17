// Compact heraldic signature: convergence ring and compass points echo the splash's O.
// Decorative by default; the surrounding control or heading supplies its accessible name.
export default function BrandSeal({ className = '' }) {
  return <svg className={`brand-seal ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <circle className="brand-seal-ring" cx="32" cy="32" r="21" />
    <circle className="brand-seal-orbit" cx="32" cy="32" r="17" strokeDasharray="1 5" />
    <path className="brand-seal-compass" d="M32 3 37 26 61 32 37 38 32 61 27 38 3 32 27 26Z" />
    <path className="brand-seal-spine" d="M32 9V55M9 32H55" />
    <path className="brand-seal-heart" d="M32 23 38 32 32 41 26 32Z" />
    <circle className="brand-seal-fire" cx="16" cy="16" r="2" />
    <circle className="brand-seal-air" cx="48" cy="16" r="2" />
    <circle className="brand-seal-water" cx="48" cy="48" r="2" />
    <circle className="brand-seal-earth" cx="16" cy="48" r="2" />
  </svg>;
}
