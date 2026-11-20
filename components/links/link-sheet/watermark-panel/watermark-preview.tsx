import { WatermarkConfig } from "@/lib/types";

import { SVGWatermark } from "@/components/view/watermark-svg";

const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 518;

const MOCK_VIEWER_DATA = {
  email: "viewer@example.com",
  date: new Date().toLocaleDateString(),
  time: new Date().toLocaleTimeString(),
  link: "Sample Link",
  ipAddress: "192.168.1.1",
};

const FINANCIAL_ROWS = [
  { label: "Total Revenue", current: "$152.4", prior: "$128.4", yoy: "18.7%" },
  { label: "Gross Profit", current: "$68.6", prior: "$56.6", yoy: "21.3%" },
  { label: "Gross Margin", current: "45.0%", prior: "44.1%", yoy: "+0.9 pp" },
  { label: "Operating Income", current: "$27.8", prior: "$22.3", yoy: "24.6%" },
  { label: "Net Income", current: "$20.4", prior: "$16.2", yoy: "26.1%" },
  { label: "Diluted EPS", current: "$0.68", prior: "$0.54", yoy: "25.9%" },
];

function FinancialReport() {
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-white px-7 py-6 text-gray-900"
      style={{ fontSize: 7, lineHeight: 1.5 }}
    >
      <h1 className="font-serif text-[13px] font-bold">
        Q1 2024 Financial Performance Report
      </h1>

      <h2 className="mt-4 text-[8px] font-bold">Executive Summary</h2>
      <p className="mt-1 text-gray-700">
        Global Tech Solutions Inc. (&ldquo;GTS&rdquo; or &ldquo;the
        Company&rdquo;) delivered a strong start to 2024, with solid revenue
        growth and improved profitability across key product lines. Continued
        operational efficiency and disciplined cost management contributed to
        robust financial results.
      </p>

      <h2 className="mt-3 text-[8px] font-bold">Financial Highlights</h2>
      <ul className="mt-1 list-disc space-y-0.5 pl-3 text-gray-700">
        <li>Total revenue increased 18.7% year-over-year to $152.4 million.</li>
        <li>
          Gross profit grew 21.3% to $68.6 million, with gross margin expanding
          to 45.0%.
        </li>
        <li>Operating income increased 24.6% to $27.8 million.</li>
        <li>
          Net income attributable to shareholders increased 26.1% to $20.4
          million.
        </li>
        <li>Diluted earnings per share rose to $0.68, compared to $0.54.</li>
      </ul>

      <h2 className="mt-3 text-[8px] font-bold">Financial Results Summary</h2>
      <table className="mt-1 w-full border-collapse text-left text-gray-700">
        <thead>
          <tr className="border-b border-gray-300 font-semibold">
            <th className="py-0.5 pr-1">in millions</th>
            <th className="py-0.5 pr-1">Q1 2024</th>
            <th className="py-0.5 pr-1">Q1 2023</th>
            <th className="py-0.5">YoY</th>
          </tr>
        </thead>
        <tbody>
          {FINANCIAL_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-gray-100">
              <td className="py-0.5 pr-1">{row.label}</td>
              <td className="py-0.5 pr-1">{row.current}</td>
              <td className="py-0.5 pr-1">{row.prior}</td>
              <td className="py-0.5">{row.yoy}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-3 text-[8px] font-bold">Outlook</h2>
      <p className="mt-1 text-gray-700">
        The Company remains focused on innovation, customer success, and
        strategic investments to drive long-term growth. We reaffirm our
        full-year 2024 guidance and are confident in our ability to deliver
        sustained value to our shareholders.
      </p>

      <span className="absolute bottom-3 right-7 text-gray-400">1</span>
    </div>
  );
}

export default function WatermarkPreview({
  config,
}: {
  config: WatermarkConfig;
}) {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-sm font-medium text-foreground">Preview</p>
      <div className="flex flex-1 justify-center">
        <div
          className="relative w-full max-w-[560px] rounded-lg bg-gray-200 p-1 shadow-lg dark:bg-gray-800"
          style={{ height: 560 }}
        >
          <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-900">
            {/* Browser chrome */}
            <div className="mx-auto flex h-7 shrink-0 items-center justify-center">
              <div className="pointer-events-none absolute left-3">
                <div className="flex flex-row flex-nowrap justify-start">
                  <div className="mr-1 inline-block size-2 rounded-full bg-gray-300" />
                  <div className="mr-1 inline-block size-2 rounded-full bg-gray-300" />
                  <div className="mr-1 inline-block size-2 rounded-full bg-gray-300" />
                </div>
              </div>
              <div className="flex items-center justify-center rounded-xl bg-white p-1 px-2 opacity-70 dark:bg-gray-800">
                <div
                  aria-hidden="true"
                  className="mr-1 mt-0.5 flex text-muted-foreground"
                >
                  <svg
                    aria-hidden="true"
                    height="8"
                    width="8"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M8.75 11.25a1.25 1.25 0 1 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z"></path>
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.5 4v2h-1a1 1 0 0 0-1 1v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a1 1 0 0 0-1-1h-1V4a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4ZM11 6V4a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 4v2h6Zm-8 7V7.5h10V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13Z"
                    ></path>
                  </svg>
                </div>
                <span className="whitespace-normal text-xs text-muted-foreground">
                  papermark.com/view/...
                </span>
              </div>
            </div>

            {/* Document viewport */}
            <div className="relative min-h-0 flex-1 overflow-auto">
              <div className="flex justify-center py-4">
                <div
                  className="relative shrink-0 shadow-sm"
                  style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}
                >
                  <FinancialReport />
                  <SVGWatermark
                    config={config}
                    viewerData={MOCK_VIEWER_DATA}
                    documentDimensions={{
                      width: PAGE_WIDTH,
                      height: PAGE_HEIGHT,
                    }}
                    pageIndex={0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
