-- Achadinhos da BIA — Criação atômica de pedido, itens e reserva.
-- EXECUTAR no SQL Editor do Supabase após revisar.
-- Esta função é EXCLUSIVA do backend (service_role).
-- Não habilita checkout e não inicia cobranças.
-- O backend DEVE validar o frete no Melhor Envio antes de chamar esta função.

begin;

create sequence if not exists public.store_order_number_seq;

-- Ajusta sequência ao maior número já existente, sem reutilizar números.
select setval(
  'public.store_order_number_seq',
  greatest(coalesce((select max(order_number) from public.orders),0),1),
  (select count(*) > 0 from public.orders)
);

create or replace function public.create_store_order(
  p_customer jsonb,
  p_items jsonb,
  p_shipping jsonb,
  p_payment_method text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_number bigint;
  v_subtotal numeric(12,2) := 0;
  v_shipping_price numeric(12,2);
  v_expires timestamptz;
  v_count integer := 0;
  v_row record;
  v_items jsonb := '[]'::jsonb;
begin
  if p_payment_method not in ('mercado_pago','pix_whatsapp') then
    raise exception 'Forma de pagamento inválida';
  end if;
  if jsonb_typeof(p_customer) is distinct from 'object'
     or jsonb_typeof(p_shipping) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Dados do pedido inválidos';
  end if;

  if length(trim(coalesce(p_customer->>'name',''))) not between 3 and 120
     or length(trim(coalesce(p_customer->>'email',''))) not between 5 and 254
     or length(trim(coalesce(p_customer->>'phone',''))) not between 8 and 25
     or length(trim(coalesce(p_shipping->>'street',''))) not between 2 and 200
     or length(trim(coalesce(p_shipping->>'number',''))) not between 1 and 30
     or length(trim(coalesce(p_shipping->>'neighborhood',''))) not between 2 and 120
     or length(trim(coalesce(p_shipping->>'city',''))) not between 2 and 120
     or coalesce(p_shipping->>'state','') !~ '^[A-Z]{2}$'
     or coalesce(p_shipping->>'zip','') !~ '^[0-9]{8}$' then
    raise exception 'Dados de contato ou endereço incompletos';
  end if;

  v_shipping_price := (p_shipping->>'validated_price')::numeric;
  if v_shipping_price is null or v_shipping_price < 0 or v_shipping_price > 100000 then
    raise exception 'Frete não validado';
  end if;

  -- A fonte de preços e disponibilidade é SEMPRE public.products.
  -- Ordenação estável evita deadlocks em compras concorrentes.
  for v_row in
    with requested as (
      select (x->>'product_id')::uuid as product_id,
             sum((x->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) x
      group by (x->>'product_id')::uuid
    )
    select p.id,p.name,p.price,p.stock,p.active,r.quantity
      from requested r
      join public.products p on p.id=r.product_id
     order by p.id
     for update of p
  loop
    if v_row.quantity not between 1 and 1000 or v_row.active is not true
       or v_row.stock < v_row.quantity or v_row.price is null or v_row.price < 0 then
      raise exception 'Produto indisponível ou quantidade inválida';
    end if;
    v_count := v_count+1;
    v_subtotal := v_subtotal + (v_row.price*v_row.quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_row.id,'name',v_row.name,'quantity',v_row.quantity,
      'unit_price',v_row.price,'line_total',v_row.price*v_row.quantity
    ));
  end loop;
  if v_count <> (select count(distinct (x->>'product_id')) from jsonb_array_elements(p_items) x)
     or v_count=0 then
    raise exception 'Há produtos inválidos ou removidos do catálogo';
  end if;

  v_number := nextval('public.store_order_number_seq');
  v_expires := now()+interval '3 hours';
  insert into public.orders (
    order_number,customer_name,customer_email,customer_phone,customer_cpf,
    shipping_zip,shipping_street,shipping_number,shipping_complement,
    shipping_neighborhood,shipping_city,shipping_state,
    shipping_company,shipping_service,shipping_price,
    subtotal,total,payment_method,payment_status,order_status,payment_expires_at
  ) values (
    v_number,trim(p_customer->>'name'),lower(trim(p_customer->>'email')),
    trim(p_customer->>'phone'),nullif(trim(p_customer->>'cpf'),''),
    p_shipping->>'zip',trim(p_shipping->>'street'),trim(p_shipping->>'number'),
    nullif(trim(p_shipping->>'complement'),''),
    trim(p_shipping->>'neighborhood'),trim(p_shipping->>'city'),p_shipping->>'state',
    nullif(trim(p_shipping->>'company'),''),
    nullif(trim(p_shipping->>'service'),''),
    v_shipping_price,v_subtotal,v_subtotal+v_shipping_price,
    p_payment_method,'pending','pending_payment',v_expires
  ) returning id into v_order_id;

  insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,line_total)
  select v_order_id,(x->>'product_id')::uuid,x->>'name',
         (x->>'quantity')::integer,(x->>'unit_price')::numeric,(x->>'line_total')::numeric
    from jsonb_array_elements(v_items) x;

  -- A função de reserva existente desconta o estoque; se falhar,
  -- a transação inteira reverte pedido e itens.
  perform public.reserve_order_stock(v_order_id,p_items);

  insert into public.order_status_history(order_id,previous_status,new_status,notes)
  values(v_order_id,null,'pending_payment','Pedido criado; pagamento pendente');

  return jsonb_build_object(
    'order_id',v_order_id,'order_number',v_number,
    'subtotal',v_subtotal,'shipping_price',v_shipping_price,
    'total',v_subtotal+v_shipping_price,'payment_expires_at',v_expires
  );
end;
$$;

revoke all on function public.create_store_order(jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_store_order(jsonb,jsonb,jsonb,text) to service_role;

commit;

-- PRÉ-REQUISITOS PARA LIBERAR O BOTÃO:
-- (1) Edge Function deve validar frete com Melhor Envio e jamais aceitar
--     validated_price vindo do cliente sem conferir no servidor.
-- (2) A Edge Function deve validar CPF, email, telefone e CEP.
-- (3) Implementar confirmação de pagamento e cancelamento idempotentes.
-- (4) Proteger contra duplicação de requisições (chave de idempotência).
-- (5) Testar concorrência de duas compras para última unidade.
