export function NovaMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="5.4" fill="currentColor" />
      <ellipse
        cx="24"
        cy="24"
        rx="20"
        ry="8"
        transform="rotate(-28 24 24)"
        stroke="currentColor"
        strokeWidth="2.4"
        opacity="0.9"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="20"
        ry="8"
        transform="rotate(32 24 24)"
        stroke="currentColor"
        strokeWidth="1.8"
        opacity="0.55"
      />
      <circle cx="41" cy="14" r="2.1" fill="currentColor" />
    </svg>
  );
}
