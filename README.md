# Ateliê Ponto a Ponto — sistema de gestão

Pedidos, clientes, caixa, relatórios (lucro líquido e ROI), catálogo de serviços, usuários e backup.
Site estático (HTML/CSS/JS, sem build) hospedado na **Vercel**, com login e banco no **Supabase**.

---

## O que vai em cada arquivo

| Arquivo | Para que serve |
|---|---|
| `index.html` | Página do sistema |
| `app.js` | Toda a lógica das telas |
| `estilo.css`, `tema.js` | Visual e tema claro/escuro |
| `config.js` | **Único arquivo que você edita**: endereço e chave do Supabase |
| `vendor/supabase.js` | Biblioteca do Supabase (versão 2.118.0), guardada no próprio repositório |
| `assets/` | Logos, ícone do app e favicon |
| `manifest.webmanifest` | Permite instalar na tela inicial do celular com o ícone da agulha |
| `vercel.json` | Cabeçalhos de segurança e "não indexar no Google" |
| `supabase.sql` | Cria o banco, as regras de segurança e as funções. Roda **no Supabase**, não vai para o site |

---

## Passo a passo (uns 25 minutos, uma vez só)

### 1. Supabase: criar o banco
1. Entre em **supabase.com** → **New project**. Nome: `atelie-ponto-a-ponto`. Região: **South America (São Paulo)**. Anote a senha do banco num lugar seguro.
2. Quando o projeto terminar de criar: menu **SQL Editor** → **New query** → cole o conteúdo **inteiro** de `supabase.sql` → **Run**. Tem que aparecer "Success".
3. Menu **Authentication** → procure a opção **Allow new users to sign up** (fica nas configurações de cadastro/Sign In) e **desligue**. Ninguém de fora cria conta.
   - Mesmo que isso fique ligado por engano, conta nova entra **bloqueada** e não vê nada até você liberar.
4. **Authentication → Users → Add user → Create new user**: crie **a sua conta** (e-mail + senha forte) e marque **Auto Confirm User**.
5. Volte ao **SQL Editor** e rode, trocando pelo seu e-mail:
   ```sql
   update public.perfis set papel = 'admin', ativo = true, nome = 'Edson'
   where email = 'SEU-EMAIL@exemplo.com';
   ```
6. Crie a conta da sua mãe do mesmo jeito do item 4. Ela fica bloqueada; você libera pelo próprio sistema (passo 4 abaixo).
7. Menu **Project Settings → API Keys**: copie a **Project URL** e a chave **Publishable** (`sb_publishable_...`).
   **Nunca** use a chave *secret* / *service_role* no site.

### 2. GitHub: subir os arquivos
1. Crie um repositório **privado** `atelie-ponto-a-ponto`.
2. **Add file → Upload files** e arraste **todo o conteúdo da pasta** (incluindo as pastas `assets` e `vendor`, mantendo a estrutura). **Commit**.
3. Abra `config.js` no GitHub (lápis ✏️), cole a Project URL e a chave Publishable nos lugares indicados, **Commit**.

### 3. Vercel: publicar
1. **vercel.com → Add New → Project** → importe o repositório `atelie-ponto-a-ponto`.
2. Framework Preset: **Other**. Não precisa de Build Command nem Output Directory. **Deploy**.
3. Copie o endereço que a Vercel gerou (ex.: `https://atelie-ponto-a-ponto.vercel.app`).
4. No Supabase: **Authentication → URL Configuration**
   - **Site URL**: cole o endereço da Vercel.
   - **Redirect URLs**: adicione o mesmo endereço.
   Sem isso, o link de "Esqueci minha senha" não volta para o sistema.

A partir daqui, **todo commit no GitHub atualiza o site sozinho** em cerca de 1 minuto.

### 4. Primeiro acesso
1. Entre com a sua conta → aba **Usuários** → **Editar** na conta da sua mãe → dê o nome, acesso **Ateliê**, marque **Acesso liberado** → Salvar.
2. Aba **Serviços**: cadastre os serviços com **preço** e **custo de material**. Sem custo, o lucro aparece maior do que é (o sistema avisa).
3. **Configurações**: taxas da maquininha (débito e crédito) e investimentos (máquinas etc.) para o ROI.
4. No celular da sua mãe: abra o endereço no navegador → **Compartilhar → Adicionar à Tela de Início** (iPhone) ou **⋮ → Instalar app** (Android). Fica com o ícone da agulha e abre em tela cheia. O login fica salvo.

---

## Regras importantes

- **Backup semanal.** O plano grátis do Supabase **não guarda cópias para você**. Em **Configurações → Baixar backup completo**, guarde o arquivo no Google Drive. O sistema avisa o administrador quando passa de 7 dias sem backup. **Restaurar backup** grava o arquivo de volta (não apaga nada do que existe).
- **Pausa por inatividade.** No plano grátis, projeto com pouca atividade em 7 dias pode ser **pausado** (os dados ficam guardados; você reativa no painel do Supabase em **Resume project**). Se o ateliê usa todo dia, não acontece. Se ela tirar férias, entre no sistema uma vez na semana.
- **Precisa de internet.** Sem internet aparece uma faixa vermelha e nada é salvo. O sistema não perde dados por isso: o que não salvou mostra erro e o formulário continua aberto.
- **Senha esquecida:** "Esqueci minha senha" na tela de entrada manda um link por e-mail. O e-mail grátis do Supabase tem limite de poucos envios por hora. Alternativa: você troca a senha dela em **Authentication → Users**.

---

## Como os números são calculados

- **Faturamento do mês**: soma dos pedidos **recebidos** no mês (pelo valor cobrado).
- **Material**: custo de material por serviço × quantidade (estimativa cadastrada no catálogo; o valor fica congelado em cada pedido).
- **Lucro líquido** = faturamento − material − despesas do mês − taxas de cartão.
- **Caixa**: o que **entrou de fato** (pagamentos registrados) e **saiu de fato** (despesas), por data.
- **ROI de um investimento** = (lucro líquido do ateliê desde a compra − valor investido) ÷ valor investido. É referência, não prova: o lucro do ateliê não vem só daquela máquina.
- Mudar o preço de um serviço **não altera** pedidos antigos.

## Segurança (o que já está pronto)

- Regras no banco (RLS): sem login e perfil **ativo**, ninguém lê nem grava nada, mesmo com a chave pública.
- Só administrador mexe em usuários, investimentos, categorias, taxas, backup e vê o **histórico de alterações** (quem criou, mudou ou excluiu cada pedido, pagamento, despesa e preço).
- O sistema não deixa ficar sem nenhum administrador ativo.
- Pedido e pagamento são gravados de uma vez só (tudo ou nada) e um toque duplo não duplica nada.
- Não deixa receber mais do que o pedido vale, nem editar o pedido para um total abaixo do que já foi pago.
- Cliente com pedidos não pode ser apagada.
- Site com cabeçalhos de segurança e marcado para não aparecer no Google.

## Manutenção

- Rodar `supabase.sql` de novo é seguro (não apaga dados) — use quando receber uma versão nova dele.
- Para atualizar o sistema, substitua o arquivo no GitHub e faça commit.
