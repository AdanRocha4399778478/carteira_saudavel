import { useNavigate } from "@tanstack/react-router";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  LabelList,
} from "recharts";
import { QUADRANT_INFO, formatDate, formatScore, initialsOf, type Client } from "@/lib/domain";
import { Pill } from "@/components/painel/badges";

type Point = {
  x: number;
  y: number;
  id: string;
  company: string;
  initials: string;
  consultant: string;
  risk: string;
  lastMeeting: string | null;
  quadrant: string;
};

const riskColor: Record<string, string> = {
  baixo: "var(--color-healthy)",
  médio: "var(--color-attention)",
  alto: "var(--color-highrisk)",
  crítico: "var(--color-critical)",
};

function MatrixTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-xl border border-border bg-popover p-3 text-xs shadow-[var(--shadow-pop)]">
      <p className="font-display text-sm font-bold">{p.company}</p>
      <p className="text-muted-foreground">Consultor: {p.consultant}</p>
      <div className="mt-2 grid gap-1">
        <p>Satisfação: {formatScore(p.y)}</p>
        <p>Valor gerado: {formatScore(p.x)}</p>
        <p>Nível de risco: {p.risk}</p>
        <p>Última reunião: {formatDate(p.lastMeeting)}</p>
      </div>
      <p className="mt-2 text-muted-foreground">Clique para abrir a conta</p>
    </div>
  );
}

export function SatisfactionValueMatrix({
  clients,
  consultantName,
}: {
  clients: Client[];
  consultantName: (id: string | null) => string;
}) {
  const navigate = useNavigate();
  const points: Point[] = clients
    .filter((c) => c.current_satisfaction !== null && c.current_value_score !== null)
    .map((c) => ({
      x: Number(c.current_value_score),
      y: Number(c.current_satisfaction),
      id: c.id,
      company: c.company_name,
      initials: initialsOf(c.company_name),
      consultant: consultantName(c.consultant_id),
      risk: c.current_risk_level,
      lastMeeting: c.last_meeting_date,
      quadrant: c.current_quadrant ?? "—",
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 7, 8, 10]}
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
              label={{
                value: "Valor gerado",
                position: "insideBottom",
                offset: -8,
                fontSize: 12,
                fill: "var(--color-muted-foreground)",
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 7, 8, 10]}
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              stroke="var(--color-border)"
              label={{
                value: "Satisfação",
                angle: -90,
                position: "insideLeft",
                fontSize: 12,
                fill: "var(--color-muted-foreground)",
              }}
            />
            <ZAxis range={[280, 280]} />
            <ReferenceLine x={7} stroke="var(--color-foreground)" strokeDasharray="4 4" />
            <ReferenceLine y={7} stroke="var(--color-foreground)" strokeDasharray="4 4" />
            <Tooltip content={<MatrixTooltip />} />
            <Scatter
              data={points}
              onClick={(p: unknown) => {
                const point = p as Point | { payload?: Point };
                const id = "id" in point ? point.id : point.payload?.id;
                if (id) void navigate({ to: "/clientes/$clientId", params: { clientId: id } });
              }}
              cursor="pointer"
            >
              {points.map((p) => (
                <Cell key={p.id} fill={riskColor[p.risk] ?? "var(--color-neutral-info)"} />
              ))}
              <LabelList
                dataKey="initials"
                position="center"
                style={{ fontSize: 10, fontWeight: 700, fill: "var(--color-primary-foreground)" }}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          Alta satisfação e alto valor a partir de nota 7. Cor do ponto indica o nível de risco;
          passe o mouse para ver os detalhes da conta.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {Object.entries(QUADRANT_INFO).map(([key, info]) => {
          const count = points.filter((p) => p.quadrant === key).length;
          return (
            <div key={key} className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <p className="min-w-0 truncate text-sm font-semibold">{key}</p>
                <Pill tone={info.tone}>{count} contas</Pill>
              </div>
              <p className="mt-1 text-xs font-medium text-muted-foreground">{info.title}</p>
              <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {info.readings.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span aria-hidden>•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
