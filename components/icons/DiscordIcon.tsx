// Discord brand glyph. Lucide doesn't ship a Discord icon — using
// Discord's official Wordmark/Clyde mark (single-color path, no fill,
// inherits currentColor via CSS).

export function DiscordIcon({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a14.4 14.4 0 0 0-.61 1.245 18.34 18.34 0 0 0-5.485 0A14 14 0 0 0 9.852 3a19.74 19.74 0 0 0-3.762 1.37C2.45 9.55 1.5 14.59 1.972 19.566a19.93 19.93 0 0 0 5.96 2.996c.479-.654.905-1.349 1.27-2.077a13 13 0 0 1-2.005-.96c.168-.122.333-.25.49-.382a14.24 14.24 0 0 0 12.626 0c.16.132.323.26.491.382a13 13 0 0 1-2.009.961c.366.728.79 1.422 1.27 2.076a19.86 19.86 0 0 0 5.965-2.996c.553-5.747-.945-10.74-3.713-15.197M8.02 16.508c-1.183 0-2.157-1.085-2.157-2.418s.955-2.418 2.157-2.418 2.176 1.085 2.157 2.418c0 1.333-.955 2.418-2.157 2.418m7.96 0c-1.183 0-2.157-1.085-2.157-2.418s.955-2.418 2.157-2.418 2.176 1.085 2.157 2.418c0 1.333-.955 2.418-2.157 2.418" />
    </svg>
  );
}
