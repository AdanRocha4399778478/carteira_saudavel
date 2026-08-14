import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteConsultantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("invite-consultant", {
        body: { full_name: fullName.trim(), email: email.trim().toLowerCase() },
      });
      if (error) {
        const context = (error as { context?: unknown }).context;
        if (context instanceof Response) {
          const payload = (await context
            .clone()
            .json()
            .catch(() => null)) as {
            error?: string;
          } | null;
          if (payload?.error) throw new Error(payload.error);
        }
        throw new Error(error.message);
      }
      if (data?.error) throw new Error(String(data.error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Convite enviado. O consultor receberá um link para definir o acesso.");
      setFullName("");
      setEmail("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim()) {
      toast.error("Informe o nome do consultor.");
      return;
    }
    if (!email.trim()) {
      toast.error("Informe o e-mail do consultor.");
      return;
    }
    invite.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Incluir consultor</DialogTitle>
          <DialogDescription>
            Enviaremos um convite por e-mail. Após aceitar, o consultor poderá acessar o painel e
            receber clientes e projetos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="consultant-name">Nome completo</Label>
            <Input
              id="consultant-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="consultant-email">E-mail</Label>
            <Input
              id="consultant-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? "Enviando…" : "Enviar convite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
