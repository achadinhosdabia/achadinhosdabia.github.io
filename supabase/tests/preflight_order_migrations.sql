-- Pré-verificação, somente leitura. Executar no SQL Editor antes de aplicar migrações.
-- Nenhum pedido é criado e nenhum estoque é alterado.
SELECT
  'orders.id' AS verificacao,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
      AND column_name='id' AND data_type='uuid'
  ) AS ok
UNION ALL
SELECT 'orders.payment_expires_at', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
    AND column_name='payment_expires_at'
)
UNION ALL
SELECT 'orders.payment_status', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
    AND column_name='payment_status'
)
UNION ALL
SELECT 'orders.order_status', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
    AND column_name='order_status'
)
UNION ALL
SELECT 'orders.cancelled_at', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
    AND column_name='cancelled_at'
)
UNION ALL
SELECT 'orders.cancellation_reason', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
    AND column_name='cancellation_reason'
)
UNION ALL
SELECT 'order_status_history.notes', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='order_status_history'
    AND column_name='notes'
)
UNION ALL
SELECT 'order_stock_reservations', to_regclass('public.order_stock_reservations') IS NOT NULL
UNION ALL
SELECT 'create_store_order', to_regprocedure('public.create_store_order(jsonb,jsonb,jsonb,text)') IS NOT NULL
UNION ALL
SELECT 'release_order_stock', to_regprocedure('public.release_order_stock(uuid)') IS NOT NULL;
