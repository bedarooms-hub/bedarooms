import { supabase, isSupabaseConfigured } from "./supabase.js";

/**
 * Backend for contract e-signatures (public.contract_signatures).
 * - Admin (bedarooms@gmail.com): read/write all (RLS "contract_signatures admin all")
 * - Renter: insert as signer='tenant' for own phone; read rows tied to own phone
 * When Supabase is not configured, calls resolve to empty/offline so UI degrades gracefully.
 */

export async function listSignatures(tenantId) {
  if (!tenantId || !isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("signed_at", { ascending: true });
  if (error) {
    console.warn("[signatures list]", error.message);
    return [];
  }
  return data || [];
}

export async function saveSignature({ tenantId, phone, signer, name, image }) {
  if (!tenantId || !signer || !name?.trim()) throw new Error("Name and signature are required");
  if (!isSupabaseConfigured || !supabase) {
    // Offline: caller should persist into tenant JSONB instead (admin path does this too)
    return { offline: true };
  }
  const digits = String(phone || "").replace(/\D/g, "");
  const { data, error } = await supabase
    .from("contract_signatures")
    .insert({
      tenant_id: tenantId,
      phone: digits,
      signer,
      name: name.trim(),
      image: image || "",
    })
    .select()
    .single();
  if (error) throw new Error(error.message || "Could not save signature");
  return data;
}

export function latestSig(sigs, signer) {
  const rows = (sigs || []).filter((s) => s.signer === signer);
  return rows.length ? rows[rows.length - 1] : null;
}
