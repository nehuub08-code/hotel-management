import React from 'react';

interface DishVisualProps {
  imageKey: string;
  name: string;
  className?: string;
}

const PALETTES: Record<
  string,
  { bg: string; plate: string; accent: string; secondary: string; garnish: string }
> = {
  burrata_fig: {
    bg: 'from-[#2A1D18] via-[#1B1310] to-[#120D0B]',
    plate: '#F4EFE8',
    accent: '#C2410C',
    secondary: '#7C2D12',
    garnish: '#65A30D',
  },
  lotus_stem: {
    bg: 'from-[#331812] via-[#20110D] to-[#140B09]',
    plate: '#1E1A18',
    accent: '#EA580C',
    secondary: '#FDBA74',
    garnish: '#84CC16',
  },
  truffle_flatbread: {
    bg: 'from-[#292018] via-[#1C1611] to-[#120E0B]',
    plate: '#292524',
    accent: '#D97706',
    secondary: '#FDE68A',
    garnish: '#4D7C0F',
  },
  pepperoni_flatbread: {
    bg: 'from-[#361712] via-[#21100D] to-[#150A08]',
    plate: '#1C1917',
    accent: '#DC2626',
    secondary: '#F59E0B',
    garnish: '#65A30D',
  },
  salmon_bowl: {
    bg: 'from-[#1F2421] via-[#151A17] to-[#0E1210]',
    plate: '#E7E5E4',
    accent: '#FB923C',
    secondary: '#FDBA74',
    garnish: '#16A34A',
  },
  lamb_chops: {
    bg: 'from-[#2D1A14] via-[#1B110E] to-[#110B09]',
    plate: '#1C1917',
    accent: '#EA580C',
    secondary: '#FEF3C7',
    garnish: '#15803D',
  },
  saffron_risotto: {
    bg: 'from-[#2E2212] via-[#1F170D] to-[#140F09]',
    plate: '#FAF8F5',
    accent: '#F59E0B',
    secondary: '#FDE047',
    garnish: '#4D7C0F',
  },
  hazelnut_torte: {
    bg: 'from-[#231915] via-[#17110E] to-[#0F0B09]',
    plate: '#E7DFD5',
    accent: '#92400E',
    secondary: '#D97706',
    garnish: '#F59E0B',
  },
  orange_tonic: {
    bg: 'from-[#381B10] via-[#21110B] to-[#140B08]',
    plate: '#292524',
    accent: '#F97316',
    secondary: '#FED7AA',
    garnish: '#65A30D',
  },
  saffron_brew: {
    bg: 'from-[#261B14] via-[#19120D] to-[#100C09]',
    plate: '#1C1917',
    accent: '#D97706',
    secondary: '#FEF3C7',
    garnish: '#F59E0B',
  },
};

export const DishVisual: React.FC<DishVisualProps> = ({ imageKey, name, className = '' }) => {
  const p = PALETTES[imageKey] || PALETTES.truffle_flatbread;
  const isBeverage = imageKey === 'orange_tonic' || imageKey === 'saffron_brew';
  const isFlatbread = imageKey.includes('flatbread');

  return (
    <div
      role="img"
      aria-label={name}
      className={`relative overflow-hidden bg-gradient-to-br ${p.bg} flex items-center justify-center select-none ${className}`}
    >
      <svg viewBox="0 0 320 240" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`glow-${imageKey}`} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor={p.accent} stopOpacity="0.24" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#glow-${imageKey})`} />

        {isBeverage ? (
          <g transform="translate(160 120)">
            <ellipse cx="0" cy="72" rx="44" ry="10" fill="#000" fillOpacity="0.35" />
            <rect
              x="-32"
              y="-64"
              width="64"
              height="132"
              rx="10"
              fill={p.secondary}
              fillOpacity="0.16"
              stroke="#FAF8F5"
              strokeOpacity="0.35"
              strokeWidth="2"
            />
            <rect x="-28" y="-34" width="56" height="96" rx="7" fill={p.accent} fillOpacity="0.82" />
            <rect x="-14" y="-22" width="20" height="20" rx="4" fill="#FFF" fillOpacity="0.25" transform="rotate(14)" />
            <rect x="2" y="8" width="18" height="18" rx="4" fill="#FFF" fillOpacity="0.2" transform="rotate(-10)" />
            <circle cx="-8" cy="-42" r="14" fill={p.secondary} fillOpacity="0.85" />
            <path d="M10 -78 L24 -28" stroke={p.garnish} strokeWidth="3" strokeLinecap="round" />
          </g>
        ) : isFlatbread ? (
          <g transform="translate(160 122)">
            <ellipse cx="0" cy="6" rx="98" ry="74" fill="#000" fillOpacity="0.35" />
            <ellipse cx="0" cy="0" rx="94" ry="70" fill={p.plate} stroke="#44403C" strokeWidth="3" />
            <path
              d="M-68 -14 C-72 -44, -18 -54, 24 -48 C68 -42, 76 -8, 66 22 C54 48, -14 52, -52 36 C-72 26, -66 4, -68 -14 Z"
              fill="#D6B588"
              stroke="#92400E"
              strokeWidth="4"
            />
            <ellipse cx="-20" cy="-12" rx="22" ry="14" fill={p.secondary} fillOpacity="0.9" />
            <ellipse cx="26" cy="8" rx="24" ry="15" fill={p.secondary} fillOpacity="0.85" />
            <circle cx="-12" cy="18" r="12" fill={p.accent} />
            <circle cx="24" cy="-18" r="11" fill={p.accent} />
            <circle cx="0" cy="0" r="8" fill={p.accent} />
            <path d="M-28 -4 Q-16 -14 -6 -4 M14 14 Q26 4 36 14" stroke={p.garnish} strokeWidth="3" strokeLinecap="round" fill="none" />
          </g>
        ) : (
          <g transform="translate(160 120)">
            <ellipse cx="0" cy="10" rx="92" ry="74" fill="#000" fillOpacity="0.38" />
            <circle cx="0" cy="0" r="82" fill={p.plate} />
            <circle cx="0" cy="0" r="64" fill="none" stroke={p.accent} strokeOpacity="0.22" strokeWidth="1.5" />
            <ellipse cx="-12" cy="-6" rx="34" ry="24" fill={p.accent} fillOpacity="0.92" transform="rotate(-12)" />
            <ellipse cx="18" cy="14" rx="28" ry="20" fill={p.secondary} fillOpacity="0.9" transform="rotate(18)" />
            <circle cx="-26" cy="20" r="12" fill={p.garnish} fillOpacity="0.88" />
            <circle cx="22" cy="-22" r="9" fill={p.accent} fillOpacity="0.7" />
            <path d="M-16 0 C-4 -18, 18 -14, 24 4" stroke="#FAF8F5" strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </g>
        )}
      </svg>
    </div>
  );
};

export const DiningHeroVisual: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    role="img"
    aria-label="Saffron & Hearth wood-fired dining room interior"
    className={`relative overflow-hidden bg-gradient-to-br from-[#1C1410] via-[#140F0C] to-[#0B0807] ${className}`}
  >
    <svg viewBox="0 0 800 520" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="hearthGlow" cx="68%" cy="48%" r="48%">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#EA580C" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#120D0B" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tableTop" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B2920" />
          <stop offset="100%" stopColor="#231813" />
        </linearGradient>
      </defs>
      <rect width="800" height="520" fill="#140E0C" />
      <rect width="800" height="520" fill="url(#hearthGlow)" />

      {/* Architectural wood-fired hearth arch */}
      <path d="M450 390 L450 220 C450 135, 620 135, 620 220 L620 390 Z" fill="#1F1612" stroke="#443027" strokeWidth="3" />
      <path d="M485 350 L485 255 C485 205, 585 205, 585 255 L585 350 Z" fill="#0F0907" />
      <ellipse cx="535" cy="340" rx="44" ry="12" fill="#EA580C" fillOpacity="0.7" />
      <path d="M518 338 C515 305, 535 280, 538 258 C545 282, 560 305, 552 338 Z" fill="#F97316" fillOpacity="0.85" />
      <path d="M528 338 C528 318, 538 302, 540 288 C545 304, 550 318, 546 338 Z" fill="#FDE047" fillOpacity="0.85" />

      {/* Pendant lamps */}
      <line x1="210" y1="0" x2="210" y2="115" stroke="#57473D" strokeWidth="2" />
      <path d="M175 145 C175 115, 245 115, 245 145 Z" fill="#D97706" />
      <ellipse cx="210" cy="148" rx="35" ry="6" fill="#FDE68A" fillOpacity="0.65" />

      <line x1="340" y1="0" x2="340" y2="85" stroke="#57473D" strokeWidth="2" />
      <path d="M312 110 C312 85, 368 85, 368 110 Z" fill="#B45309" />
      <ellipse cx="340" cy="112" rx="28" ry="5" fill="#FDE68A" fillOpacity="0.55" />

      {/* Foreground dining table setting */}
      <path d="M40 370 L390 355 L460 520 L0 520 Z" fill="url(#tableTop)" stroke="#523A2E" strokeWidth="2" />
      <ellipse cx="215" cy="435" rx="76" ry="34" fill="#FAF8F5" />
      <ellipse cx="215" cy="433" rx="56" ry="24" fill="#F5EDE4" stroke="#E7D8C9" strokeWidth="1.5" />
      <ellipse cx="215" cy="432" rx="34" ry="14" fill="#EA580C" fillOpacity="0.85" />
      <circle cx="195" cy="428" r="8" fill="#FDE68A" />
      <circle cx="232" cy="434" r="6" fill="#65A30D" />
      <circle cx="325" cy="402" r="14" fill="#F97316" fillOpacity="0.28" />
      <rect x="319" y="388" width="12" height="24" rx="3" fill="#FAF8F5" fillOpacity="0.75" />
      <path d="M325 384 C322 374, 328 368, 325 362 C329 368, 331 376, 325 384 Z" fill="#FBBF24" />
    </svg>
  </div>
);
