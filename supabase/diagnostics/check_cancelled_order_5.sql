-- Auditoria somente leitura do cancelamento do pedido #5.
-- Verifica status, itens e se cada reserva foi liberada.
SELECT o.order_number, o.order_status, o.payment_status,
       o.cancelled_at, o.cancellation_reason,
       (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i))
          FROM public.order_items i WHERE i.order_id = o.id) AS itens,
       (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r))
          FROM public.order_stock_reservations r WHERE r.order_id = o.id) AS reservas
FROM public.orders o
WHERE o.order_number = 5;
