# Regras de trabalho (valem sempre)
- Trabalhar em etapas pequenas, num worktree novo a partir do origin/main, com a branch indicada no prompt. Caminhos com "/" no Git Bash.
- Nada de commit, push, PR, merge, deploy ou migration sem autorização explícita no prompt da etapa.
- Nunca abrir nem imprimir arquivos .env*.
- Não rodar prettier --write nem eslint --fix (o repositório já tem violações antigas). Rodar eslint só nos arquivos tocados e informar apenas violações NOVAS.
- Mudança de regra de negócio, de status, de limiar, de classificação ou cor nova: parar e perguntar antes.
- Se um teste existente afirmar o comportamento que será mudado: parar e perguntar.
- Se algo divergir do descrito no prompt: parar e avisar.
- Usar só funções e componentes que já existem; não criar consulta nova ao banco sem perguntar.
- Merge só com verify e Vercel em pass e com main sem mudança desde o commit-base; senão parar.
- Esta sessão precisa estar ligada ao computador do usuário. Se o repositório local não existir, parar.
- Relatório final CURTO, em português simples: o que muda para o usuário, totais de tsc e testes, hashes e links. Não colar diff, salvo se o prompt pedir expressamente.
- Todo PR registra limitações conhecidas e como reverter.

## Ciclo de vida do worktree

1. Toda sessão que criar um worktree é responsável por removê-lo.
2. Depois que o PR for mergeado e a main local for atualizada: primeiro SAIR da pasta do worktree (`cd` para o worktree principal; remover de dentro dela dá "Permission denied" e deixa a pasta para trás), então `git worktree remove <pasta do próprio worktree>`, SEM `--force`, e depois `git worktree prune`. Se o worktree foi desregistrado e sobrou pasta VAZIA, apagar com `Remove-Item`; pasta com conteúdo: parar e reportar.
3. Se o remove recusar (arquivo sujo ou commit não enviado), NÃO forçar: parar e reportar o que está sujo.
4. Nunca remover um worktree que não foi criado pela própria sessão.
5. PR abandonado ou fechado sem merge: avisar o usuário, não remover sozinho.
