-- ============================================================
-- BeDa Rooms — Supabase SQL Fix for Renter Online Payments
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Drop old restrictive policy and replace with full CRUD for renters
DROP POLICY IF EXISTS "rental_data renter read admin" ON public.rental_data;

-- Create a policy that allows renters to READ and WRITE admin data
-- This enables GCash/Maya payments to be saved to Supabase
CREATE POLICY "rental_data renter full access" ON public.rental_data
  FOR ALL
  USING (
    auth.uid() = user_id
    OR (
      (auth.jwt() ->> 'email') LIKE '%@renter.beda-rooms.local'
      AND user_id = (SELECT id FROM auth.users WHERE email = 'bedarooms@gmail.com' LIMIT 1)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (
      (auth.jwt() ->> 'email') LIKE '%@renter.beda-rooms.local'
      AND user_id = (SELECT id FROM auth.users WHERE email = 'bedarooms@gmail.com' LIMIT 1)
    )
  );

-- 2. Enable RLS on rental_data (should already be enabled, but ensure)
ALTER TABLE public.rental_data ENABLE ROW LEVEL SECURITY;

-- 3. Add trigger to track payment method in updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rental_data_updated_at ON public.rental_data;
CREATE TRIGGER rental_data_updated_at
  BEFORE UPDATE ON public.rental_data
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Add a function to safely record online payments (GCash/Maya)
-- This function can be called by a Supabase Edge Function or directly
CREATE OR REPLACE FUNCTION public.record_online_payment(
  p_tenant_id TEXT,
  p_period_key TEXT,
  p_payment_method TEXT,
  p_amount NUMERIC,
  p_paid_date TEXT DEFAULT to_char(now(), 'YYYY-MM-DD')
)
RETURNS JSONB AS $$
DECLARE
  v_data JSONB;
  v_tenant RECORD;
BEGIN
  -- Get the rental data
  SELECT r.data INTO v_data
  FROM public.rental_data r
  WHERE r.user_id = (SELECT id FROM auth.users WHERE email = 'bedarooms@gmail.com' LIMIT 1);

  IF v_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No rental data found');
  END IF;

  -- Find the tenant and update their payment record
  v_data := jsonb_set(
    v_data,
    ARRAY['payments', p_tenant_id, p_period_key],
    jsonb_build_object(
      'status', 'paid',
      'amountPaid', p_amount,
      'paidDate', p_paid_date,
      'paymentMethod', p_payment_method,
      'interestApplied', 0,
      'charges', COALESCE((v_data #> ARRAY['payments', p_tenant_id, p_period_key, 'charges'])::jsonb, '[]'::jsonb),
      'notes', COALESCE((v_data #> ARRAY['payments', p_tenant_id, p_period_key, 'notes'])::jsonb, '')
    ),
    true
  );

  -- Update the rental_data row
  UPDATE public.rental_data
  SET data = v_data, updated_at = now()
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'bedarooms@gmail.com' LIMIT 1);

  RETURN jsonb_build_object('success', true, 'data', v_data);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Grant execute permission on the function to authenticated users
GRANT EXECUTE ON FUNCTION public.record_online_payment TO authenticated;

-- 6. Create a policy to allow renters to call the function
CREATE POLICY "Allow renters to record online payments"
  ON public.record_online_payment
  FOR EXECUTE
  USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' LIKE '%@renter.beda-rooms.local'
  );

-- 7. Ensure the tenant data structure supports paymentMethod field
-- This is already handled by JSONB, but add a comment
COMMENT ON COLUMN public.rental_data.data IS 'JSONB data including tenants[], payments{}, settings{}';
COMMENT ON TABLE public.rental_data IS 'Single row per user. payments[tenantId][periodKey] includes {status, amountPaid, paidDate, paymentMethod, interestApplied, charges, notes}';

-- 8. Add an index for faster payment lookups
CREATE INDEX IF NOT EXISTS idx_rental_data_payments ON public.rental_data USING gin ((data -> 'payments'));

-- ============================================================
-- To use the Edge Function from the frontend, also deploy this:
--
-- Supabase Edge Function: record-online-payment
--
-- Export this as a Supabase Edge Function and call it from the
-- frontend instead of directly updating the database.
--
-- OR, the simpler approach: just ensure RLS allows INSERT/UPDATE
-- as done in policy #1 above. The existing storage.js cloudSet
-- will then work because the renter can now write to the admin's row.
-- ============================================================

-- ============================================================
-- QUICK FIX (if you just want to make it work immediately):
-- Run only policy #1 and #2 above, then restart your dev server.
-- The existing storage.js will automatically sync payments to Supabase.
-- ============================================================

-- Verify the policies are set correctly
SELECT
  policyname,
  command,
  row_filter
FROM pg_policies
WHERE tablename = 'rental_data';
