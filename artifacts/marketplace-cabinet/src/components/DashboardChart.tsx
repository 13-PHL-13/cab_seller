import { useEffect, useRef, useState } from "react";
import {
  change,
  money,
  quantity,
  type DashboardPoint,
  type DashboardMetric,
} from "@/lib/dashboard-model";
export interface ChartSeries {
  key: DashboardMetric;
  label: string;
  color: string;
  values: Array<number | null>;
  previous?: boolean;
  dash?: string;
}
const short = (n: number) =>
  n >= 1000
    ? (n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " тыс."
    : quantity(n);
export function Change({
  value,
  previous,
  inverse = false,
  title,
}: {
  value: number | null;
  previous: number | null;
  inverse?: boolean;
  title?:string;
}) {
  const delta = change(value, previous);
  return (
    <span
      title={title}
      className={
        "metric-change " +
        (delta === null || delta === 0
          ? "neutral"
          : delta > 0 !== inverse
            ? "positive"
            : "negative")
      }
    >
      {delta === null
        ? "Нет данных"
        : (delta > 0 ? "+" : "") +
          delta.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) +
          "%"}
    </span>
  );
}
export default function DashboardChart({
  title,
  dates,
  series,
  current,
  previous,
  bar = false,
  unit = "count",
}: {
  title: string;
  dates: string[];
  series: ChartSeries[];
  current: DashboardPoint[];
  previous: DashboardPoint[];
  bar?: boolean;
  unit?: "count" | "money";
}) {
  const container = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(800),
    [active, setActive] = useState<number | null>(null),
    hits = useRef<Array<SVGGElement | null>>([]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(520, entry.contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const W = width,
    H = bar ? 166 : 150,
    left = 62,
    right = 18,
    top = bar ? 25 : 16,
    bottom = H - 34,
    step = (W - left - right) / 14,
    x = (i: number) => left + (i + 0.5) * step;
  const all = series
      .flatMap((s) => s.values)
      .filter((v): v is number => v !== null && Number.isFinite(v)),
    peak = Math.max(1, ...all),
    upper = peak * 1.12,
    power = 10 ** Math.floor(Math.log10(upper / 4)),
    tick =
      ([1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
        (n) => n * power >= upper / 4,
      ) ?? 10) * power,
    max = tick * 4,
    y = (n: number) => bottom - (n / max) * (bottom - top),
    divisor =
      unit === "money"
        ? max >= 1000000
          ? 1000000
          : max >= 1000
            ? 1000
            : 1
        : 1;
  const format = (n: number | null) =>
      unit === "money" ? money(n) : quantity(n),
    label = (date: string) =>
      new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      });
  function segments(values: Array<number | null>) {
    const parts: Array<Array<[number, number]>> = [];
    let part: Array<[number, number]> = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (part.length) parts.push(part);
        part = [];
      } else part.push([x(i), y(v)]);
    });
    if (part.length) parts.push(part);
    return parts;
  }
  const rows = title.includes("Воронка")
    ? [
        ["views", "Перешли в карточку"],
        ["carts", "Добавили в корзину"],
        ["orders", "Заказали"],
        ["bought", "Выкупили"],
      ]
    : title.includes("Выкуп")
      ? [
          ["bought", "Выкуплено"],
          ["boughtAmount", "Сумма"],
          ["margin", "Маржа"],
        ]
      : [
          ["orders", "Заказано"],
          ["orderAmount", "Сумма"],
          ["margin", "Маржа"],
        ];
  return (
    <div
      className="dashboard-chart"
      ref={container}
    >
      <div className="plot">
        <svg
          className="time-chart"
          data-chart-unit={unit}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActive(null);
          }}
          onPointerCancel={() => setActive(null)}
        >
          <title>{title}</title>
          {unit === "money" && (
            <text x={left} y={12} className="chart-axis-unit">
              {divisor === 1000000
                ? "млн ₽"
                : divisor === 1000
                  ? "тыс. ₽"
                  : "₽"}
            </text>
          )}
          {[0, 1, 2, 3, 4].map((k) => (
            <g key={k}>
              <line
                x1={left}
                x2={W - right}
                y1={y((max * k) / 4)}
                y2={y((max * k) / 4)}
                className="grid-line"
              />
              <text
                x={left - 10}
                y={y((max * k) / 4) + 4}
                textAnchor="end"
                className="axis-label"
                opacity={all.length ? 1 : 0}
              >
                {unit === "money"
                  ? ((max * k) / 4 / divisor).toLocaleString("ru-RU", {
                      maximumFractionDigits: 2,
                    })
                  : short((max * k) / 4)}
              </text>
            </g>
          ))}
          {dates.map((date, i) => (
            <g key={date}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={top}
                y2={bottom}
                className="vertical-grid"
              />
              <text
                x={x(i)}
                y={H - 11}
                textAnchor="middle"
                className="date-label"
              >
                {label(date)}
              </text>
            </g>
          ))}
          {(bar
            ? series
            : [...series].sort(
                (a, b) => Number(!!b.previous) - Number(!!a.previous),
              )
          ).map((s, index) => (
            <g key={`${s.key}-${index}`}>
              {bar && index === 0 ? (
                s.values.map((v, i) =>
                  v === null ? null : (
                    <g key={i}>
                      <rect
                        x={x(i) - step * 0.3}
                        y={y(v)}
                        width={step * 0.6}
                        height={Math.max(0, bottom - y(v))}
                        rx={8}
                        fill={s.color}
                      />
                      <text
                        x={x(i)}
                        y={y(v) - 8}
                        textAnchor="middle"
                        className="bar-value"
                      >
                        {unit === "money"
                          ? (v / divisor).toLocaleString("ru-RU", {
                              maximumFractionDigits: 1,
                            })
                          : quantity(v)}
                      </text>
                    </g>
                  ),
                )
              ) : (
                <>
                  {segments(s.values).map((points, i) => (
                    <polyline
                      key={i}
                      points={points.map((p) => p.join(",")).join(" ")}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.previous ? 1.8 : 2.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray={
                        s.dash ?? (s.previous ? "6 5" : undefined)
                      }
                    />
                  ))}
                  {s.values.map((v, i) =>
                    v === null ? null : (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(v)}
                        r={s.previous ? 2.6 : 3.4}
                        fill="white"
                        stroke={s.color}
                        strokeWidth={1.7}
                      />
                    ),
                  )}
                </>
              )}
            </g>
          ))}
          {!all.length && (
            <text
              x={W / 2}
              y={H / 2}
              textAnchor="middle"
              className="no-chart-data"
            >
              Нет данных
            </text>
          )}
          {dates.map((date, i) => (
            <g
              key={date}
              ref={(el) => {
                hits.current[i] = el;
              }}
              className={"chart-date-hit " + (active === i ? "is-active" : "")}
              tabIndex={0}
              role="button"
              aria-label={label(date) + ": показать все показатели"}
              onPointerEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => {
                let next: number | null = null;
                if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
                if (e.key === "ArrowRight") next = Math.min(13, i + 1);
                if (e.key === "Home") next = 0;
                if (e.key === "End") next = 13;
                if (next !== null) {
                  e.preventDefault();
                  hits.current[next]?.focus();
                }
                if (e.key === "Escape") setActive(null);
              }}
            >
              <rect
                x={left + i * step}
                y={top}
                width={step}
                height={H - top - 3}
                fill="transparent"
              />
              <line
                className="chart-hover-guide"
                x1={x(i)}
                x2={x(i)}
                y1={top}
                y2={bottom}
              />
            </g>
          ))}
        </svg>
      </div>
      <div
        data-chart-kind={title.includes("Воронка") ? "funnel" : "commerce"}
        className={"chart-detail-dock " + (active !== null ? "is-open" : "")}
      >
        {active === null ? (
          <p className="chart-detail-hint">
            Наведите на дату графика, чтобы увидеть показатели
          </p>
        ) : (
          <div
            className="chart-tooltip"
            role="region"
            aria-label="Показатели за выбранную дату"
          >
            <div className="chart-detail-header">
              <strong>
                {new Date(dates[active] + "T12:00:00Z").toLocaleDateString(
                  "ru-RU",
                  { day: "numeric", month: "long" },
                )}
              </strong>
              <span>Изменение к предыдущему дню</span>
            </div>
            <div className="chart-tooltip-rows">
              {rows.map(([key, name]) => {
                const metric = key as DashboardMetric,
                  value = current[active]?.[metric] ?? null,
                  prior = active
                    ? (current[active - 1]?.[metric] ?? null)
                    : (previous.at(-1)?.[metric] ?? null),
                  comparison = previous[active]?.[metric] ?? null;
                return (
                  <div className="chart-tooltip-row" key={key}>
                    <span className="chart-tooltip-label">{name}</span>
                    <strong>
                      {key.includes("Amount") || key === "margin"
                        ? money(value)
                        : quantity(value)}
                    </strong>
                    <Change value={value} previous={prior} />
                    <span className="chart-tooltip-detail previous">
                      Пред. период:{" "}
                      {key.includes("Amount")
                        ? money(comparison)
                        : quantity(comparison)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
