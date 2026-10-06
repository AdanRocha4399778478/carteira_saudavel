import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERP_MACRO_AREAS, ERP_TAXONOMY } from "@/lib/domain";
import { erpCode, getErpItems } from "@/lib/erp-hierarchy";

const NENHUM_ITEM = "nenhum";

/**
 * Dois <Select> encadeados (área obrigatória -> subárea), no mesmo padrão do TimerWidget.
 * Quando `onItemChange` é passado, mostra também um terceiro <Select> opcional de item
 * (terceiro nível do ERP); trocar área ou subárea limpa o item. Sem `onItemChange`, o
 * comportamento é idêntico ao de antes (só área + subárea, grid de 2 colunas).
 */
export function ErpAreaSubareaSelect({
  area,
  subarea,
  onChange,
  item,
  onItemChange,
}: {
  area: string;
  subarea: string;
  onChange: (area: string, subarea: string) => void;
  item?: string;
  onItemChange?: (item: string) => void;
}) {
  const subareaOptions = area ? (ERP_TAXONOMY[area] ?? []) : [];
  const itemOptions = area && subarea ? getErpItems(area, subarea) : [];

  const handleAreaChange = (v: string) => {
    onChange(v, "");
    onItemChange?.("");
  };
  const handleSubareaChange = (v: string) => {
    onChange(area, v);
    onItemChange?.("");
  };

  return (
    <div className={onItemChange ? "grid gap-2 sm:grid-cols-2" : "grid grid-cols-2 gap-2"}>
      <div className="grid gap-1.5">
        <Label>Área do ERP *</Label>
        <Select value={area} onValueChange={handleAreaChange}>
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
        <Select value={subarea} onValueChange={handleSubareaChange} disabled={!area}>
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
      {onItemChange ? (
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Item do ERP (opcional)</Label>
          <Select
            value={item || NENHUM_ITEM}
            onValueChange={(v) => onItemChange(v === NENHUM_ITEM ? "" : v)}
            disabled={!subarea}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue
                className="truncate"
                placeholder={subarea ? "Selecione" : "Escolha a subárea primeiro"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM_ITEM}>Nenhum (projeto na subárea)</SelectItem>
              {itemOptions.map((it) => (
                <SelectItem key={it} value={it}>
                  {erpCode(area, subarea, it)} · {it}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
