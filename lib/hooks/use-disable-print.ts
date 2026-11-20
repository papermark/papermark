import { useEffect } from "react";

interface UseDisablePrintOptions {
    styleId?: string;
}

export function useDisablePrint({
    styleId = "printing-disabled-style",
}: UseDisablePrintOptions = {}) {
    useEffect(() => {
        // Hide all content unconditionally inside the print media query. This is
        // pure CSS, so it blocks printing / "Save as PDF" even on browsers that
        // do not fire `beforeprint`/`afterprint` or `matchMedia('print')` change
        // events (e.g. Samsung Internet, Opera Mini), without relying on JS to
        // toggle a class at print time.
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
      @media print {
        body {
          display: none !important;
        }
      }
    `;
        document.head.appendChild(style);

        return () => {
            document.getElementById(styleId)?.remove();
        };
    }, [styleId]);
}
