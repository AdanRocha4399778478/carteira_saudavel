import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applySpeakerMapEdit, type SpeakerMapEntry } from "@/lib/speaker-map";

/**
 * Editor da sugestão de falantes da IA (rótulo da transcrição -> nome
 * real). Mesmas convenções de props de ContextListEditor (label/
 * description/items/onChange/disabled). Editar o NOME confirma a linha
 * (nome preenchido = confiança "alta"; apagado = "baixa"); editar só o
 * papel não muda a confiança (ver applySpeakerMapEdit em speaker-map.ts).
 * Sem itens, não renderiza nada.
 */
export function SpeakerMapEditor({
  label,
  description,
  items,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  items: SpeakerMapEntry[];
  onChange: (items: SpeakerMapEntry[]) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;

  function update(index: number, patch: Partial<SpeakerMapEntry>) {
    onChange(
      items.map((item, i) => (i === index ? applySpeakerMapEdit(item, patch) : item)),
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      {description ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      ) : null}

      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Rótulo</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Papel</TableHead>
            <TableHead>Confiança</TableHead>
            <TableHead>Evidência</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.label || index}>
              <TableCell className="whitespace-nowrap text-sm">{item.label}</TableCell>
              <TableCell>
                <Input
                  value={item.name}
                  disabled={disabled}
                  placeholder="Nome real"
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Select
                  {...(item.role ? { value: item.role } : {})}
                  disabled={Boolean(disabled)}
                  onValueChange={(v) => update(index, { role: v as SpeakerMapEntry["role"] })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consultor">Consultor</SelectItem>
                    <SelectItem value="cliente">Cliente</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Badge variant={item.confidence === "baixa" ? "outline" : "secondary"}>
                  {item.confirmed ? "confirmado" : item.confidence}
                </Badge>
              </TableCell>
              <TableCell className="max-w-xs text-xs text-muted-foreground">
                {item.evidence || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
