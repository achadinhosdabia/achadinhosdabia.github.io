-- Achadinhos da BIA: preparação para vencimento de pagamento em 3 horas.
-- Execute no SQL Editor do Supabase de testes.
-- Esta migração NÃO agenda cancelamentos nem libera estoque.
-- O job só deve ser ativado após webhook Mercado Pago e reserva de estoque transacional.

begin;

alter table public.orders
  add column if not exists payment_expires_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

-- Preenche apenas novos pedidos, sem alterar o prazo de pedidos antigos.
alter table public.orders
  alter column payment_expires_at set default (now() + interval '3 hours');

create index if not exists idx_orders_pending_expiration
  on public.orders (payment_expires_at)
  where order_status = 'pending_payment';

comment on column public.orders.payment_expires_at is
  'Prazo UTC para pagamento: criado em +3 horas; confirmado pelo backend.';
comment on column public.orders.cancellation_reason is
  'Motivo do cancelamento: customer_requested, payment_expired, etc.';

commit;

-- IMPORTANTE:
-- 1. A expiração automática será executada por backend confiável, não por JavaScript.
-- 2. Antes de cancelar, consultar status atual do pagamento no Mercado Pago.
-- 3. Reservar/liberar estoque em transação atômica e evitar liberações duplicadas.
-- 4. Cancelamento do cliente exigirá token individual, opaco e com expiração,
--    validado no servidor (nunca confiar em número do pedido ou CPF isoladamente).
-- 5. Não criar cron neste estágio: checkout e webhook ainda não estão ativos.
