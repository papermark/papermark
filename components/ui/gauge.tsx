export const Gauge = ({
  value,
  size = "small",
  showValue = true,
}: {
  value: number;
  size: "xxs" | "xs" | "small" | "medium" | "large";
  showValue: boolean;
}) => {
  const circumference = 332; //2 * Math.PI * 53; // 2 * pi * radius
  const valueInCircumference = (value / 100) * circumference;
  const strokeDasharray = `${circumference} ${circumference}`;
  const initialOffset = circumference;
  const strokeDashoffset = initialOffset - valueInCircumference;

  const sizes = {
    xxs: {
      width: "20",
      height: "20",
      textSize: "text-[10px]",
    },
    xs: {
      width: "24",
      height: "24",
      textSize: "text-[10px]",
    },
    small: {
      width: "36",
      height: "36",
      textSize: "text-xs",
    },
    medium: {
      width: "72",
      height: "72",
      textSize: "text-lg",
    },
    large: {
      width: "144",
      height: "144",
      textSize: "text-3xl",
    },
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg
        fill="none"
        shapeRendering="crispEdges"
        height={sizes[size].height}
        width={sizes[size].width}
        viewBox="0 0 120 120"
        strokeWidth="2"
        className="-rotate-90 transform"
      >
        <circle
          className="text-gray-200 dark:text-gray-800"
          strokeWidth="12"
          stroke="currentColor"
          fill="transparent"
          shapeRendering="geometricPrecision"
          r="53"
          cx="60"
          cy="60"
        />
        <circle
          className="animate-gauge_fill text-emerald-500"
          strokeWidth="12"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={initialOffset}
          shapeRendering="geometricPrecision"
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r="53"
          cx="60"
          cy="60"
          style={{
            strokeDashoffset: strokeDashoffset,
            transition: "stroke-dasharray 1s ease 0s,stroke 1s ease 0s",
          }}
        />
      </svg>
      {showValue ? (
        <div className="absolute flex animate-gauge_fadeIn opacity-0">
          <p className={`text-foreground ${sizes[size].textSize}`}>{value}</p>
        </div>
      ) : null}
    </div>
  );
};
