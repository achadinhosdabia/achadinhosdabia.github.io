-- Achadinhos da BIA — confirmação MANUAL de pagamento verificado.
-- NÃO EXECUTAR AINDA: revisar fluxo administrativo antes da instalação.
-- Mercado Pago exige confirmação por webhook validado; esta função não valida pagamentos externos.
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_store_order_payment(
  p_order_id uuid,
  p_reference text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido obrigatório';
  END IF;
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN false; -- Já confirmado; não gerar histórico duplicado.
  END IF;
  IF v_order.payment_status <> 'pending'
     OR v_order.order_status <> 'pending_payment'
     OR v_order.payment_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Pedido não está pendente ou já venceu';
  END IF;
  -- Confirmação é decisão de um operador/serviço autorizado, após verificar o pagamento.
  UPDATE public.orders
     SET payment_status = 'paid',
         order_status = 'payment_confirmed'
   WHERE id = p_order_id;
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, notes
  ) VALUES (
    p_order_id, 'pending_payment', 'payment_confirmed',
    'Pagamento confirmado por operador/serviço autorizado'
  );
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_store_order_payment(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_order_payment(uuid,text)
  TO service_role;
COMMIT;
