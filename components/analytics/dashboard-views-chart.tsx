import { useMemo } from "react";

import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TimeRange } from "./time-range-select";

interface DashboardViewsChartProps {
  timeRange: TimeRange;
  data?: { date: string; views: number }[];
  startDate?: Date;
  endDate?: Date;
}

export default function DashboardViewsChart({
  timeRange,
  data = [],
  startDate,
  endDate,
}: DashboardViewsChartProps) {
  const totalDays =
    startDate && endDate
      ? Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;
  // Format the data for display
  const formattedData = useMemo(() => {
    // Generate all possible time slots
    const now = new Date();
    const slots: { date: Date; views: number }[] = [];
    if (timeRange === "custom" && startDate && endDate) {
      if (totalDays > 365) {
        // More than a year: Group by months
        let current = new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          1,
        );

        while (current <= endDate) {
          slots.push({ date: new Date(current), views: 0 });
          current.setMonth(current.getMonth() + 1);
        }
      } else if (totalDays > 30) {
        // More than a month but less than a year: Group by weeks
        for (let i = 0; i <= totalDays; i += 7) {
          const date = new Date(startDate);
          date.setDate(date.getDate() + i);
          date.setHours(0, 0, 0, 0);
          slots.push({ date, views: 0 });
        }
      } else {
        // Less than a month: Show daily data
        for (let i = 0; i <= totalDays; i++) {
          const date = new Date(startDate);
          date.setDate(date.getDate() + i);
          date.setHours(0, 0, 0, 0);
          slots.push({ date, views: 0 });
        }
      }
    } else if (timeRange === "24h") {
      // Generate 24 hourly slots
      for (let i = 23; i >= 0; i--) {
        const date = new Date(now);
        date.setHours(date.getHours() - i);
        date.setMinutes(0, 0, 0); // Reset minutes, seconds, milliseconds
        slots.push({ date, views: 0 });
      }
    } else {
      // Generate daily slots for 7d or 30d
      const days = timeRange === "7d" ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0); // Reset hours, minutes, seconds, milliseconds
        slots.push({ date, views: 0 });
      }
    }

    // Fill in actual data points
    if (data) {
      data.forEach((point) => {
        const pointDate = new Date(point.date);

        let slotIndex = -1;

        if (timeRange === "24h") {
          slotIndex = slots.findIndex(
            (slot) => slot.date.getHours() === pointDate.getHours(),
          );
        } else if (timeRange === "custom") {
          if (totalDays > 365) {
            // If range is more than a year, match by month
            slotIndex = slots.findIndex(
              (slot) =>
                slot.date.getFullYear() === pointDate.getFullYear() &&
                slot.date.getMonth() === pointDate.getMonth(),
            );
          } else if (totalDays > 30) {
            // If range is more than a month but less than a year, match by week
            slotIndex = slots.findIndex(
              (slot) =>
                pointDate >= slot.date &&
                pointDate <
                  new Date(slot.date.getTime() + 7 * 24 * 60 * 60 * 1000), // Within the week
            );
          } else {
            // If range is less than a month, match by exact day
            slotIndex = slots.findIndex(
              (slot) => slot.date.toDateString() === pointDate.toDateString(),
            );
          }
        } else {
          // Default case: match by exact day for '7d' and '30d'
          slotIndex = slots.findIndex(
            (slot) => slot.date.toDateString() === pointDate.toDateString(),
          );
        }

        if (slotIndex !== -1) {
          slots[slotIndex].views += point.views;
        }
      });
    }

    // Format for display
    return slots.map((slot) => ({
      date: slot.date,
      name: format(
        slot.date,
        timeRange === "24h"
          ? "h:mm aa"
          : totalDays > 365
            ? "MMM yyyy"
            : totalDays > 30
              ? "MMM d"
              : "EEE, MMM d",
      ),
      views: slot.views,
    }));
  }, [data, timeRange, startDate, endDate, totalDays]);

  // Calculate tick values based on time range
  const ticks = useMemo(() => {
    if (!formattedData.length) return [];

    if (timeRange === "24h") {
      // Show current hour and every 5th hour working backwards
      const tickIndices = [];
      for (let i = formattedData.length - 1; i >= 0; i -= 5) {
        tickIndices.unshift(i);
      }
      return tickIndices.map((i) => formattedData[i].name);
    } else if (timeRange === "7d") {
      // Show all days
      return formattedData.map((d) => d.name);
    } else if (timeRange === "30d") {
      // Show current day and every 5th day working backwards
      const tickIndices = [];
      for (let i = formattedData.length - 1; i >= 0; i -= 5) {
        tickIndices.unshift(i);
      }
      return tickIndices.map((i) => formattedData[i].name);
    } else if (timeRange === "custom") {
      if (totalDays > 365) {
        // Show every 2rd month
        return formattedData.filter((_, i) => i % 2 === 0).map((d) => d.name);
      }

      if (totalDays > 30) {
        // Show every 2nd week
        return formattedData.filter((_, i) => i % 2 === 0).map((d) => d.name);
      }
      return formattedData.map((d) => d.name);
    }
    return formattedData.map((d) => d.name);
  }, [timeRange, formattedData, totalDays]);

  const barSize = useMemo(() => {
    if (timeRange === "24h") return 14;
    if (timeRange === "7d") return 32;
    if (timeRange === "30d") return 16;

    if (startDate && endDate) {
      if (totalDays > 365) return 32;
      if (totalDays > 30) return 22;
    }

    return 16;
  }, [timeRange, startDate, endDate, totalDays]);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={formattedData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          barSize={barSize}
        >
          <XAxis
            dataKey="name"
            stroke="#888888"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            ticks={ticks}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#888888"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}`}
          />
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col">
                        <span className="text-[0.70rem] uppercase text-muted-foreground">
                          Time
                        </span>
                        <span className="font-bold text-muted-foreground">
                          {format(
                            data.date,
                            timeRange === "24h"
                              ? "h:mm aa"
                              : totalDays > 365
                                ? "MMM yyyy"
                                : totalDays > 30
                                  ? "'Week of' MMM d"
                                  : "MMM d, yyyy",
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[0.70rem] uppercase text-muted-foreground">
                          Views
                        </span>
                        <span className="font-bold">{data.views}</span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar
            dataKey="views"
            fill="rgb(16 185 129)"
            stroke="rgb(16 185 129)"
            strokeWidth={1}
            radius={[0, 0, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
