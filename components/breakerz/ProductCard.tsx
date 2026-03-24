import Link from 'next/link';
import type { Product, Sport } from '@/lib/types';

interface Props {
  product: Product & { sport: Sport };
}

function MfrLogo({ manufacturer }: { manufacturer: string }) {
  const mfr = manufacturer.toLowerCase();

  if (mfr === 'topps') {
    return (
      <div style={{ background: '#d62828', padding: '3px 7px', borderRadius: '2px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.08em', color: 'white', lineHeight: 1, textTransform: 'uppercase' as const }}>
          Topps
        </span>
      </div>
    );
  }

  if (mfr === 'panini') {
    return (
      <div style={{ background: '#1a1a2e', padding: '3px 7px', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '2px' }}>
        <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', color: 'white', lineHeight: 1, textTransform: 'lowercase' as const }}>
          panini
        </span>
        <span style={{ display: 'inline-block', width: '4px', height: '4px', borderRadius: '50%', background: '#e8b84b', flexShrink: 0 }} />
      </div>
    );
  }

  if (mfr.includes('upper deck')) {
    return (
      <div style={{ background: '#2d2d2d', padding: '3px 6px', borderRadius: '2px', border: '1px solid #888', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.1em', color: '#ddd', lineHeight: 1, textTransform: 'uppercase' as const }}>
          UD
        </span>
      </div>
    );
  }

  // Default badge
  return (
    <div style={{ background: 'oklch(0.87 0.01 85)', padding: '3px 7px', borderRadius: '2px', display: 'flex', alignItems: 'center' }}>
      <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.12em', color: 'oklch(0.28 0.08 250)', textTransform: 'uppercase' as const }}>
        {manufacturer}
      </span>
    </div>
  );
}

function artworkStyle(sport: string): React.CSSProperties {
  const s = sport.toLowerCase();

  if (s === 'basketball') {
    return {
      backgroundImage: [
        'radial-gradient(circle at 50% 18%, transparent 34%, oklch(0.28 0.08 250 / 0.06) 34.5%, oklch(0.28 0.08 250 / 0.06) 36%, transparent 36.5%)',
        'radial-gradient(ellipse 95% 55% at 50% 105%, transparent 82%, oklch(0.28 0.08 250 / 0.06) 82.5%, oklch(0.28 0.08 250 / 0.06) 84%, transparent 84.5%)',
      ].join(', '),
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
    };
  }

  if (s === 'baseball') {
    return {
      backgroundImage: 'radial-gradient(ellipse 140% 50% at 50% 115%, transparent 60%, oklch(0.28 0.08 250 / 0.055) 60.5%, oklch(0.28 0.08 250 / 0.055) 62%, transparent 62.5%)',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '100% 100%',
    };
  }

  if (s === 'football') {
    return {
      backgroundImage: [
        'repeating-linear-gradient(180deg, transparent 0px, transparent 22px, oklch(0.28 0.08 250 / 0.055) 22px, oklch(0.28 0.08 250 / 0.055) 24px)',
        'repeating-linear-gradient(90deg, transparent 0, transparent 27%, oklch(0.28 0.08 250 / 0.038) 27%, oklch(0.28 0.08 250 / 0.038) 29%, transparent 29%, transparent 71%, oklch(0.28 0.08 250 / 0.038) 71%, oklch(0.28 0.08 250 / 0.038) 73%, transparent 73%)',
      ].join(', '),
    };
  }

  return {};
}

function isPreRelease(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  return new Date(releaseDate + 'T00:00:00') > new Date();
}

export default function ProductCard({ product }: Props) {
  const sport = product.sport?.name ?? '';
  const preRelease = isPreRelease(product.release_date);

  return (
    <Link href={`/break/${product.slug}`} className="group block" style={{ aspectRatio: '5/7' }}>
      {/* Outer navy border */}
      <div
        className="relative h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-1"
        style={{
          border: '8px solid oklch(0.28 0.08 250)',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        {/* Inner red border */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: '2px solid oklch(0.52 0.22 27)',
            margin: '3px',
            borderRadius: '1px',
            zIndex: 5,
          }}
        />

        {/* Card face */}
        <div className="absolute inset-0 flex flex-col" style={{ background: 'oklch(0.975 0.008 85)' }}>

          {/* Top bar: manufacturer logo + sport pill */}
          <div className="flex items-center justify-between px-3 py-2.5" style={{ zIndex: 4 }}>
            <MfrLogo manufacturer={product.manufacturer} />
            <span
              className="text-[8px] font-bold uppercase tracking-widest"
              style={{ color: 'oklch(0.28 0.08 250)' }}
            >
              {sport}
            </span>
          </div>

          {/* Artwork area — sport geometry + year + ornament */}
          <div
            className="flex-1 relative flex flex-col items-center justify-center px-3 overflow-hidden"
            style={{ zIndex: 3, ...artworkStyle(sport) }}
          >
            {/* Basketball lane */}
            {sport.toLowerCase() === 'basketball' && (
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2"
                style={{
                  width: '38%',
                  height: '42%',
                  border: '2px solid oklch(0.28 0.08 250 / 0.06)',
                  borderBottom: 'none',
                }}
              />
            )}

            {/* Baseball diamond */}
            {sport.toLowerCase() === 'baseball' && (
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  width: '55%',
                  aspectRatio: '1',
                  bottom: '15%',
                  border: '2px solid oklch(0.28 0.08 250 / 0.06)',
                  transform: 'translateX(-50%) rotate(45deg)',
                }}
              />
            )}

            {/* Year */}
            <span
              className="relative z-10 leading-none tracking-tight"
              style={{
                fontFamily: 'var(--font-playfair)',
                fontWeight: 900,
                fontSize: 'clamp(28px, 5vw, 44px)',
                color: 'oklch(0.28 0.08 250)',
                opacity: 0.25,
              }}
            >
              {product.year}
            </span>

            {/* Ornament */}
            <div className="relative z-10 flex items-center gap-2 w-full mt-1.5">
              <div className="flex-1 h-px" style={{ background: 'oklch(0.52 0.02 250 / 0.35)' }} />
              <div className="w-1.5 h-1.5 rotate-45 shrink-0" style={{ background: 'oklch(0.52 0.22 27)' }} />
              <div className="flex-1 h-px" style={{ background: 'oklch(0.52 0.02 250 / 0.35)' }} />
            </div>

            {/* Set name */}
            <span
              className="relative z-10 mt-2 text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: 'oklch(0.52 0.02 250)' }}
            >
              {product.name.replace(/^\d{4}(-\d{2,4})?\s+/i, '').replace(/\s+(basketball|baseball|football|hockey|soccer)/i, '')}
            </span>

            {/* Pre-release ribbon */}
            {preRelease && (
              <div
                className="absolute bottom-2 right-0 z-20"
                style={{
                  background: 'oklch(0.75 0.15 65)',
                  color: 'white',
                  fontSize: '7px',
                  fontWeight: 900,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '3px 8px 3px 10px',
                  borderRadius: '2px 0 0 2px',
                  boxShadow: '-1px 1px 3px rgba(0,0,0,0.2)',
                }}
              >
                Pre-Release
              </div>
            )}
          </div>

          {/* Nameplate */}
          <div
            className="relative px-3.5 pt-2.5 pb-2"
            style={{ background: 'oklch(0.28 0.08 250)', zIndex: 4 }}
          >
            <div
              className="absolute top-0 left-0 right-0"
              style={{ height: '2px', background: 'oklch(0.52 0.22 27)' }}
            />
            <p
              className="leading-snug"
              style={{
                fontFamily: 'var(--font-playfair)',
                fontWeight: 700,
                fontSize: 'clamp(11px, 1.8vw, 13px)',
                color: 'white',
              }}
            >
              {product.name}
            </p>
          </div>

          {/* Stats strip */}
          <div
            className="flex gap-3 px-3.5 py-2"
            style={{ background: 'oklch(0.93 0.012 85)', borderTop: '1px solid oklch(0.87 0.01 85)', zIndex: 4 }}
          >
            {product.hobby_case_cost ? (
              <div>
                <p className="text-[7px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'oklch(0.52 0.02 250)' }}>Hobby</p>
                <p className="text-[11px] font-semibold font-mono" style={{ color: 'oklch(0.28 0.08 250)' }}>
                  ${product.hobby_case_cost.toLocaleString()}
                </p>
              </div>
            ) : null}
            {product.bd_case_cost ? (
              <div>
                <p className="text-[7px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'oklch(0.52 0.02 250)' }}>BD</p>
                <p className="text-[11px] font-semibold font-mono" style={{ color: 'oklch(0.28 0.08 250)' }}>
                  ${product.bd_case_cost.toLocaleString()}
                </p>
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </Link>
  );
}
