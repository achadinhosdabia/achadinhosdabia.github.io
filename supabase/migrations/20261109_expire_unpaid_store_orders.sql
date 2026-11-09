-- Achadinhos da BIA: cancelar pedidos vencidos e devolver reservas.
-- NÃO executar antes de revisar o fluxo de confirmação de pagamentos.
-- O agendamento (pg_cron ou Edge Function agendada) será configurado separadamente.
BEGIN;
CREATE OR REPLACE FUNCTION public.expire_unpaid_store_orders(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  rec record;
  v_count integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Limite inválido';
  END IF;
  FOR rec IN
    SELECT id
      FROM public.orders
     WHERE payment_status = 'pending'
       AND order_status = 'pending_payment'
       AND payment_expires_at <= pg_catalog.now()
     ORDER BY payment_expires_at, id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.orders
       SET payment_status = 'expired',
           order_status = 'cancelled',
           cancelled_at = pg_catalog.now(),
           cancellation_reason = 'Prazo de pagamento de 3 horas encerrado'
     WHERE id = rec.id
       AND payment_status = 'pending'
       AND order_status = 'pending_payment';
    IF FOUND THEN
      -- O bloqueio do pedido deve ser respeitado também pela confirmação de pagamento.
      PERFORM public.release_order_stock(rec.id);
      INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, notes
      ) VALUES (
        rec.id, 'pending_payment', 'cancelled',
        'Cancelamento automático por vencimento do prazo de pagamento'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_unpaid_store_orders(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_store_orders(integer)
  TO service_role;
COMMIT;
