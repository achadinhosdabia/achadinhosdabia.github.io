-- Consulta somente leitura: conferir cancelamento e liberação de estoque do pedido #5.
-- Não modifica dados.
SELECT o.order_number, o.order_status, o.payment_status, o.cancelled_at,
       o.cancellation_reason, oi.product_name, oi.quantity,
       p.stock_quantity AS estoque_atual,
       osr.released_at AS reserva_liberada_em
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
LEFT JOIN public.order_stock_reservations osr ON osr.order_id = o.id AND osr.product_id = oi.product_id
LEFT JOIN public.products p ON p.id = oi.product_id
WHERE o.order_number = 5
ORDER BY oi.product_name;
