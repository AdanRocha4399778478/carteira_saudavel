import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type EvolutionPoint = {
  label: string;
  satisfacao: number | null;
  valor: number | null;
  risco: number | null;
};

const axis = { fontSize: 12, fill: "var(--color-muted-foreground)" };

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--color-popover-foreground)",
};

export function EvolutionChart({ data, height = 280 }: { data: EvolutionPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={axis} stroke="var(--color-border)" />
        <YAxis domain={[0, 12]} tick={axis} stroke="var(--color-border)" />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="satisfacao"
          name="Satisfação média"
          stroke="var(--color-chart-1)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="valor"
          name="Valor gerado médio"
          stroke="var(--color-chart-2)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="risco"
          name="Risco médio"
          stroke="var(--color-chart-3)"
          strokeWidth={2.5}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export type NamedCount = { name: string; value: number; color: string };

export function RiskDonut({ data }: { data: NamedCount[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} stroke="var(--color-card)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function BandBars({ data, label }: { data: NamedCount[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="name" tick={axis} stroke="var(--color-border)" />
        <YAxis allowDecimals={false} tick={axis} stroke="var(--color-border)" />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" name={label} radius={[8, 8, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
