-- Achadinhos da BIA — Reserva de estoque transacional.
-- ETAPA DE PREPARAÇÃO. Não habilita checkout nem pagamentos.
-- Execute somente após revisar no Supabase SQL Editor.
-- Não concede EXECUTE a anon/authenticated.

begin;

create table if not exists public.order_stock_reservations (
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (order_id, product_id)
);

alter table public.order_stock_reservations enable row level security;
revoke all on public.order_stock_reservations from anon, authenticated;
-- Nenhuma policy de acesso público: somente backend com credenciais privilegiadas.

create or replace function public.reserve_order_stock(
  p_order_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec record;
  v_count integer := 0;
begin
  if p_order_id is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido e itens obrigatórios';
  end if;

  -- Itens duplicados são agrupados antes da reserva.
  for rec in
    select (item->>'product_id')::uuid as product_id,
           sum((item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as item
     group by (item->>'product_id')::uuid
     order by (item->>'product_id')::uuid
  loop
    if rec.quantity is null or rec.quantity < 1 or rec.quantity > 1000 then
      raise exception 'Quantidade inválida';
    end if;
    update public.products
       set stock = stock - rec.quantity
     where id = rec.product_id and active = true and stock >= rec.quantity;
    if not found then
      raise exception 'Estoque insuficiente ou produto indisponível: %', rec.product_id;
    end if;
    insert into public.order_stock_reservations(order_id,product_id,quantity)
      values(p_order_id,rec.product_id,rec.quantity);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'Nenhum item válido'; end if;
end;
$$;

create or replace function public.release_order_stock(p_order_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec record;
  v_released integer := 0;
begin
  -- A trava de linha impede liberação dupla concorrente.
  for rec in
    select product_id,quantity
      from public.order_stock_reservations
     where order_id = p_order_id and released_at is null
     order by product_id for update
  loop
    update public.products set stock = stock + rec.quantity where id = rec.product_id;
    update public.order_stock_reservations
       set released_at = now()
     where order_id = p_order_id and product_id = rec.product_id and released_at is null;
    v_released := v_released + 1;
  end loop;
  return v_released;
end;
$$;

revoke all on function public.reserve_order_stock(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.release_order_stock(uuid) from public, anon, authenticated;

comment on function public.reserve_order_stock(uuid,jsonb) is
  'Somente backend privilegiado: invocar dentro da mesma transação que cria pedido e itens; nunca confiar em preços do cliente.';
comment on function public.release_order_stock(uuid) is
  'Somente backend privilegiado: liberar após verificar cancelamento e pagamento; idempotente por reserva.';

commit;

-- PRÓXIMOS PASSOS ANTES DE ATIVAR:
-- 1. Criar pedido, itens e reserva numa única transação no backend.
-- 2. Validar preços e frete no servidor; não aceitar totais enviados pelo navegador.
-- 3. Implementar webhook idempotente do Mercado Pago e confirmação manual do PIX.
-- 4. Cancelamento em 3 horas apenas após verificar pagamento e travar pedido.
-- 5. Não chamar essas funções diretamente do navegador.
