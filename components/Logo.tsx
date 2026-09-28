import Image from "next/image";

type Variant = "mark" | "wordmark" | "lockup" | "icon" | "slab";
type Theme = "auto" | "dark" | "light";
type IconTheme = "brand" | "dark" | "green" | "light";

type LogoProps = {
  variant?: Variant;
  theme?: Theme;
  iconTheme?: IconTheme;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
};

function markSrc(theme: Theme) {
  return theme === "light" ? "/brand/mark-light.svg" : "/brand/mark.svg";
}

function wordmarkSrc(theme: Theme) {
  return theme === "light" ? "/brand/wordmark-light.svg" : "/brand/wordmark.svg";
}

function iconSrc(t: IconTheme) {
  return `/brand/icon-${t}.svg`;
}

function slabSrc(theme: Theme) {
  return theme === "light" ? "/brand/slab-icon-light.svg" : "/brand/slab-icon.svg";
}

/**
 * Which asset(s) to render. An explicit theme renders one image. "auto"
 * renders BOTH and lets CSS show the one matching the nearest theme scope
 * (.logo-on-light / .logo-on-dark in globals.css) — an <img> can't be
 * recolored by CSS variables, and admin stays dark inside a light app.
 *
 * Naming: the "light" asset is the one FOR light backgrounds (near-black
 * ink, e.g. wordmark-light.svg is #231f20); the default asset is white.
 */
function themesFor(theme: Theme): { asset: Theme; cls?: string }[] {
  if (theme !== "auto") return [{ asset: theme }];
  return [
    { asset: "light", cls: "logo-on-light" },
    { asset: "dark", cls: "logo-on-dark" },
  ];
}

const DEFAULTS = {
  mark: { width: 32, height: 32 },
  wordmark: { width: 140, height: 28 },
  lockup: { width: 200, height: 40 },
  icon: { width: 40, height: 40 },
  slab: { width: 25, height: 32 },
};

export function Logo({
  variant = "wordmark",
  theme = "auto",
  iconTheme = "brand",
  width,
  height,
  className,
  priority,
}: LogoProps) {
  if (variant === "lockup") {
    const h = height ?? DEFAULTS.lockup.height;
    return (
      <span
        className={className}
        style={{ display: "inline-flex", alignItems: "center", gap: h * 0.3, height: h }}
      >
        <Image
          src={iconSrc(iconTheme)}
          alt=""
          width={h}
          height={h}
          priority={priority}
          aria-hidden
          style={{ height: h, width: h }}
        />
        {themesFor(theme).map(({ asset, cls }) => (
          <Image
            key={asset}
            src={wordmarkSrc(asset)}
            alt="BreakIQ"
            width={Math.round(h * 4.92)}
            height={h}
            priority={priority}
            className={cls}
            style={{ height: h * 0.62, width: "auto" }}
          />
        ))}
      </span>
    );
  }

  if (variant === "icon") {
    const dims = DEFAULTS.icon;
    return (
      <Image
        src={iconSrc(iconTheme)}
        alt="BreakIQ"
        width={width ?? dims.width}
        height={height ?? dims.height}
        className={className}
        priority={priority}
      />
    );
  }

  const dims = DEFAULTS[variant];
  const srcFor = (t: Theme) =>
    variant === "mark"
      ? markSrc(t)
      : variant === "slab"
        ? slabSrc(t)
        : wordmarkSrc(t);
  return (
    <>
      {themesFor(theme).map(({ asset, cls }) => (
        <Image
          key={asset}
          src={srcFor(asset)}
          alt="BreakIQ"
          width={width ?? dims.width}
          height={height ?? dims.height}
          className={[className, cls].filter(Boolean).join(" ")}
          priority={priority}
        />
      ))}
    </>
  );
}
