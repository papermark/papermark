export default function Stripe({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 512 512"
      fill="none"
      className={className}
    >
      <g clipPath="url(#stripe_clip)">
        <rect width="512" height="512" fill="#000000" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M120 392L392 334.317V120L120 178.357V392Z"
          fill="white"
        />
      </g>
      <defs>
        <clipPath id="stripe_clip">
          <rect width="512" height="512" rx="64" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
