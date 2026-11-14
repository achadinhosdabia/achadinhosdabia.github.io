-- Achadinhos da BIA — protecao de cancelamento e vinculo Mercado Pago.
-- Execute no SQL Editor ANTES de agendar expire_unpaid_store_orders.
-- Nao cancela pedidos nem agenda tarefas durante esta migracao.
BEGIN;

-- Evita vincular uma cobranca a um pedido que foi cancelado ou venceu.
-- O bloqueio FOR UPDATE serializa esta operacao com cancelamento/expiracao.
CREATE OR REPLACE FUNCTION public.guard_mp_order_link_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = NEW.store_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado para vinculo Mercado Pago';
  END IF;
  IF v_order.order_status <> 'pending_payment'
     OR v_order.payment_status <> 'pending'
     OR v_order.payment_method <> 'mercado_pago'
     OR v_order.payment_expires_at IS NULL
     OR v_order.payment_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Pedido nao elegivel para vinculo Mercado Pago';
  END IF;
  IF pg_catalog.round(v_order.total::numeric * 100)::bigint <> NEW.amount_cents THEN
    RAISE EXCEPTION 'Valor do vinculo Mercado Pago diverge do pedido';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_mp_order_link_insert ON public.mp_order_links;
CREATE TRIGGER trg_guard_mp_order_link_insert
BEFORE INSERT ON public.mp_order_links
FOR EACH ROW
EXECUTE FUNCTION public.guard_mp_order_link_insert();

REVOKE ALL ON FUNCTION public.guard_mp_order_link_insert() FROM PUBLIC, anon, authenticated;

-- Pedidos com qualquer vinculo MP nao sao cancelados automaticamente:
-- a confirmacao ou rejeicao no provedor deve ser conciliada antes.
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
    RAISE EXCEPTION 'Limite invalido';
  END IF;

  FOR rec IN
    SELECT o.id
      FROM public.orders AS o
     WHERE o.payment_status = 'pending'
       AND o.order_status = 'pending_payment'
       AND o.payment_expires_at <= pg_catalog.now()
     ORDER BY o.payment_expires_at, o.id
     LIMIT p_limit
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    -- Segunda verificacao apos obter bloqueio da linha do pedido.
    IF EXISTS (
      SELECT 1 FROM public.mp_order_links AS l
       WHERE l.store_order_id = rec.id
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.orders
       SET payment_status = 'cancelled',
           order_status = 'cancelled',
           cancelled_at = pg_catalog.now(),
           cancellation_reason = 'Prazo de pagamento encerrado'
     WHERE id = rec.id
       AND payment_status = 'pending'
       AND order_status = 'pending_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.mp_order_links AS l
          WHERE l.store_order_id = rec.id
       );

    IF FOUND THEN
      PERFORM public.release_order_stock(rec.id);
      INSERT INTO public.order_status_history (
        order_id, previous_status, new_status, notes
      ) VALUES (
        rec.id, 'pending_payment', 'cancelled',
        'Cancelamento automatico por vencimento do prazo de pagamento'
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

-- A mesma protecao vale para o cancelamento manual pelo admin.
CREATE OR REPLACE FUNCTION public.cancel_store_order_admin(
  p_order_id uuid,
  p_reason text DEFAULT 'Cancelamento administrativo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_released integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido obrigatorio';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado';
  END IF;
  IF v_order.order_status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object(
      'order_id', p_order_id, 'status', 'already_cancelled'
    );
  END IF;
  IF v_order.order_status <> 'pending_payment'
     OR v_order.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'Apenas pedidos aguardando pagamento podem ser cancelados';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mp_order_links AS l
     WHERE l.store_order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Pedido com cobranca Mercado Pago vinculada: conciliar pagamento antes de cancelar';
  END IF;

  UPDATE public.orders
     SET order_status = 'cancelled',
         payment_status = 'cancelled',
         cancelled_at = pg_catalog.now(),
         cancellation_reason = pg_catalog.left(
           COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''), 'Cancelamento administrativo'), 250
         )
   WHERE id = p_order_id;

  SELECT public.release_order_stock(p_order_id) INTO v_released;
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, notes
  ) VALUES (
    p_order_id, 'pending_payment', 'cancelled', 'Cancelamento administrativo'
  );

  RETURN pg_catalog.jsonb_build_object(
    'order_id', p_order_id,
    'status', 'cancelled',
    'released_reservations', v_released
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_store_order_admin(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_store_order_admin(uuid,text)
  TO service_role;

COMMIT;
