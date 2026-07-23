"use client";

import dynamic from "next/dynamic";

const AdTrendChart = dynamic(
  () => import("./trend-chart").then((mod) => mod.AdTrendChart),
  { ssr: false },
);

export { AdTrendChart };
