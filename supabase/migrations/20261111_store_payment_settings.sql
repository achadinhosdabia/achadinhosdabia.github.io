-- Preferências administrativas do Mercado Pago; NÃO armazenar tokens nesta tabela.
BEGIN;
CREATE TABLE IF NOT EXISTS public.store_payment_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
 provider text NOT NULL DEFAULT 'mercado_pago' CHECK(provider='mercado_pago'),
 display_name text NOT NULL DEFAULT 'Achadinhos da BIA',
 pix_enabled boolean NOT NULL DEFAULT true,
 card_enabled boolean NOT NULL DEFAULT true,
 pix_expiration_minutes integer NOT NULL DEFAULT 30 CHECK(pix_expiration_minutes BETWEEN 15 AND 1440),
 integration_status text NOT NULL DEFAULT 'not_connected' CHECK(integration_status IN ('not_connected','configured','active')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.store_payment_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.store_payment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_payment_settings FROM anon,authenticated;
GRANT SELECT,UPDATE ON public.store_payment_settings TO authenticated;
DROP POLICY IF EXISTS payment_settings_admin_read ON public.store_payment_settings;
CREATE POLICY payment_settings_admin_read ON public.store_payment_settings FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS payment_settings_admin_update ON public.store_payment_settings;
CREATE POLICY payment_settings_admin_update ON public.store_payment_settings FOR UPDATE TO authenticated
USING(EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id=(SELECT auth.uid())))
WITH CHECK(EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id=(SELECT auth.uid())));
COMMIT;
