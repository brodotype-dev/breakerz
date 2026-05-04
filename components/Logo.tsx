import Image from "next/image";

type Variant = "mark" | "wordmark" | "lockup" | "icon" | "slab";
type Theme = "auto" | "dark" | "light";
type IconTheme = "gradient" | "dark" | "green" | "light";

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
  iconTheme = "gradient",
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
        <Image
          src={wordmarkSrc(theme)}
          alt="BreakIQ"
          width={Math.round(h * 4.92)}
          height={h}
          priority={priority}
          style={{ height: h * 0.62, width: "auto" }}
        />
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
  const src =
    variant === "mark"
      ? markSrc(theme)
      : variant === "slab"
        ? slabSrc(theme)
        : wordmarkSrc(theme);
  return (
    <Image
      src={src}
      alt="BreakIQ"
      width={width ?? dims.width}
      height={height ?? dims.height}
      className={className}
      priority={priority}
    />
  );
}
