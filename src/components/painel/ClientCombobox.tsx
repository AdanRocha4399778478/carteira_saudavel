import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Client } from "@/lib/domain";

/** Seletor de cliente pesquisável — evita renderizar listas longas sem busca. */
export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = "Selecione o cliente",
  disabled,
}: {
  clients: Client[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = clients.find((c) => c.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.company_name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar cliente…" />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.company_name}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 size-4", c.id === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="truncate">{c.company_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
