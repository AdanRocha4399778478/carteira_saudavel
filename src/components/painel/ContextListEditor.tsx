import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { newContextItem, type ContextItem } from "@/lib/projects";

/**
 * Editor de uma lista do contexto. O formato dos itens é o mesmo que os
 * futuros agentes de IA usarão (`origin: "ia"`), por isso a origem é exibida.
 */
export function ContextListEditor({
  label,
  description,
  items,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  items: ContextItem[];
  onChange: (items: ContextItem[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, newContextItem(text)]);
    setDraft("");
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

      <ul className="mt-2 flex flex-col gap-1.5">
        {items.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Nenhum item registrado.
          </li>
        ) : (
          items.map((item, index) => (
            <li
              key={item.id || index}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-muted/50 px-3 py-2"
            >
              <span className="min-w-0 text-sm">
                {item.text}
                {item.origin === "ia" ? (
                  <Badge variant="secondary" className="ml-2 gap-1 align-middle text-[10px]">
                    <Sparkles className="size-3" aria-hidden /> IA
                  </Badge>
                ) : null}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remover item ${index + 1} de ${label}`}
                disabled={disabled}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-2 flex gap-2">
        <Input
          value={draft}
          disabled={disabled}
          placeholder={`Adicionar em ${label.toLowerCase()}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={add} disabled={disabled}>
          <Plus className="size-4" aria-hidden />
          <span className="sr-only">Adicionar</span>
        </Button>
      </div>
    </div>
  );
}
