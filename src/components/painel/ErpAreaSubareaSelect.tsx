import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERP_MACRO_AREAS, ERP_TAXONOMY } from "@/lib/domain";

/** Dois <Select> encadeados (área obrigatória -> subárea), no mesmo padrão do TimerWidget. */
export function ErpAreaSubareaSelect({
  area,
  subarea,
  onChange,
}: {
  area: string;
  subarea: string;
  onChange: (area: string, subarea: string) => void;
}) {
  const subareaOptions = area ? (ERP_TAXONOMY[area] ?? []) : [];

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="grid gap-1.5">
        <Label>Área do ERP *</Label>
        <Select value={area} onValueChange={(v) => onChange(v, "")}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {ERP_MACRO_AREAS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Subárea do ERP *</Label>
        <Select value={subarea} onValueChange={(v) => onChange(area, v)} disabled={!area}>
          <SelectTrigger>
            <SelectValue placeholder={area ? "Selecione" : "Escolha a área primeiro"} />
          </SelectTrigger>
          <SelectContent>
            {subareaOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
