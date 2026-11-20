export type Data = {
  pageNumber: string;
  data: {
    versionNumber: number;
    avg_duration: number;
  }[];
};

export type SumData = {
  pageNumber: string;
  sum_duration: number;
};

export type PageDurationRow = {
  versionNumber: number;
  pageNumber: string;
  avg_duration: number;
};

/** Lays averages over every page, so unopened pages still plot as empty bars. */
export const buildPageDurationSeries = (
  rows: PageDurationRow[],
  totalPagesMax: number,
): Data[] => {
  const series: Data[] = Array.from({ length: totalPagesMax }, (_, index) => ({
    pageNumber: (index + 1).toString(),
    data: [{ versionNumber: 1, avg_duration: 0 }],
  }));

  const byPage = new Map(series.map((page) => [page.pageNumber, page]));

  for (const row of rows) {
    const page = byPage.get(row.pageNumber);
    if (!page) {
      const added: Data = {
        pageNumber: row.pageNumber,
        data: [
          { versionNumber: row.versionNumber, avg_duration: row.avg_duration },
        ],
      };
      series.push(added);
      byPage.set(added.pageNumber, added);
      continue;
    }

    const version = page.data.find(
      (candidate) => candidate.versionNumber === row.versionNumber,
    );
    if (version) version.avg_duration = row.avg_duration;
    else
      page.data.push({
        versionNumber: row.versionNumber,
        avg_duration: row.avg_duration,
      });
  }

  return series.sort(
    (left, right) => parseInt(left.pageNumber) - parseInt(right.pageNumber),
  );
};

export type TransformedData = {
  pageNumber: string;
  [key: string]: number | string; // Adjusted type to accommodate version keys
};

export type CustomTooltipTypeBar = {
  payload: any;
  active: boolean | undefined;
  label: any;
};

export type Color =
  | "neutral"
  | "emerald"
  | "gray"
  | "slate"
  | "zinc"
  | "stone"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose"
  | "gray-300";

export const getColors = (versionNumbers: string[]): Color[] => {
  const colorArray = [
    "emerald",
    "teal",
    "gray",
    "orange",
    "zinc",
    "neutral",
    "stone",
    "red",
    "amber",
    "yellow",
    "lime",
    "green",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];
  return versionNumbers.map((versionNumber: string) => {
    const versionIndex = parseInt(versionNumber.split(" ")[1]) - 1;
    return colorArray[versionIndex % colorArray.length] as Color;
  });
};

export const getColorForVersion = (versionNumber: string): Color => {
  const versionIndex = parseInt(versionNumber.split(" ")[1]) - 1;
  const colorArray = [
    "emerald",
    "teal",
    "gray",
    "orange",
    "zinc",
    "neutral",
    "stone",
    "red",
    "amber",
    "yellow",
    "lime",
    "green",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];
  return colorArray[versionIndex % colorArray.length] as Color;
};

export const timeFormatter = (number: number) => {
  const totalSeconds = Math.floor(number / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  // Adding zero padding if seconds less than 10
  const secondsFormatted = seconds < 10 ? `0${seconds}` : `${seconds}`;

  return `${minutes}:${secondsFormatted}`;
};
