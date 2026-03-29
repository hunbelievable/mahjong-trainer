"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface WinProbPoint {
  turn: number;
  probBefore: number;
  probAfter: number;
  action: string;
  tileLabel: string;
}

// ── Single-player props ────────────────────────────────────────────────────────

interface SingleProps {
  data: WinProbPoint[];
  multiData?: never;
  currentTurn: number;
  onSeek?: (turn: number) => void;
}

// ── Multi-player props ─────────────────────────────────────────────────────────

export type MultiChartPoint = { turn: number } & Record<string, number>;

interface MultiProps {
  data?: never;
  multiData: MultiChartPoint[];
  currentTurn: number;
  onSeek?: (turn: number) => void;
}

type WinProbChartProps = SingleProps | MultiProps;

// ── Colours per seat ──────────────────────────────────────────────────────────

const SEAT_COLORS: Record<string, string> = {
  E: "#6366f1",   // indigo  — East
  S: "#10b981",   // emerald — South
  W: "#f59e0b",   // amber   — West
  N: "#ef4444",   // red     — North
};
const SEAT_LABELS: Record<string, string> = { E: "East", S: "South", W: "West", N: "North" };

// ── Single-player tooltip ─────────────────────────────────────────────────────

function SingleTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: WinProbPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const delta = d.probAfter - d.probBefore;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs">
      <div className="font-semibold text-gray-700 mb-1">T{d.turn} — {d.action} {d.tileLabel}</div>
      <div className="text-gray-500">Before: <span className="font-mono text-indigo-600">{(d.probBefore * 100).toFixed(1)}%</span></div>
      <div className="text-gray-500">After: <span className="font-mono text-indigo-600">{(d.probAfter * 100).toFixed(1)}%</span></div>
      <div className={`font-semibold mt-0.5 ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-gray-400"}`}>
        {delta > 0 ? `+${(delta * 100).toFixed(1)}%` : delta < 0 ? `${(delta * 100).toFixed(1)}%` : "No change"}
      </div>
    </div>
  );
}

// ── Multi-player tooltip ──────────────────────────────────────────────────────

function MultiTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs space-y-0.5">
      <div className="font-semibold text-gray-600 mb-1">Turn {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-gray-600">{SEAT_LABELS[p.dataKey] ?? p.dataKey}:</span>
          <span className="font-mono" style={{ color: p.color }}>{(p.value * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WinProbChart({ data, multiData, currentTurn, onSeek }: WinProbChartProps) {
  const empty = (data?.length ?? multiData?.length ?? 0) === 0;
  if (empty) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-gray-400 italic">
        No move data recorded yet.
      </div>
    );
  }

  // ── Multi-player mode ───────────────────────────────────────────────────────
  if (multiData) {
    const seats = Object.keys(multiData[0] ?? {}).filter(k => k !== "turn");
    return (
      <div className="w-full h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={multiData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="turn" tick={{ fontSize: 10, fill: "#9ca3af" }} />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={v => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              width={38}
            />
            <Tooltip content={<MultiTooltip />} />
            <Legend
              formatter={seat => SEAT_LABELS[seat] ?? seat}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11 }}
            />
            {currentTurn >= 0 && (
              <ReferenceLine x={currentTurn} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" />
            )}
            {seats.map(seat => (
              <Line
                key={seat}
                type="monotone"
                dataKey={seat}
                stroke={SEAT_COLORS[seat] ?? "#94a3b8"}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, cursor: onSeek ? "pointer" : "default" }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Single-player mode ──────────────────────────────────────────────────────
  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="turn" tick={{ fontSize: 10, fill: "#9ca3af" }} />
          <YAxis
            domain={[0, 1]}
            tickFormatter={v => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            width={38}
          />
          <Tooltip content={<SingleTooltip />} />
          {currentTurn >= 0 && (
            <ReferenceLine x={currentTurn} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 2" />
          )}
          <Line
            type="monotone"
            dataKey="probBefore"
            stroke="#6366f1"
            strokeWidth={2}
            dot={(props: { cx?: number; cy?: number; payload?: WinProbPoint }) => {
              const { cx, cy, payload } = props;
              if (!cx || !cy || !payload) return <g />;
              const isActive = payload.turn === currentTurn;
              return (
                <circle
                  key={payload.turn}
                  cx={cx} cy={cy}
                  r={isActive ? 6 : 4}
                  fill={isActive ? "#6366f1" : "#a5b4fc"}
                  stroke={isActive ? "#4f46e5" : "#6366f1"}
                  strokeWidth={isActive ? 2 : 1}
                  style={{ cursor: onSeek ? "pointer" : "default" }}
                  onClick={() => onSeek?.(payload.turn)}
                />
              );
            }}
            activeDot={false}
            name="Win prob"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
