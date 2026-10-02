import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";

export const ID_BUCKET = "renter-ids";
const MAX_FILE_MB = 5;
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function sanitizeName(name) {
  return String(name || "id")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "id";
}

/**
 * Upload a renter ID photo to Supabase Storage.
 * Path: renter-ids/<phone-digits>/<tenantId>-<timestamp>-<filename>
 * RLS: admin (bedarooms@gmail.com) can write all; renter can write own phone folder.
 * Falls back to a local dataURL when Supabase is not configured (offline/demo).
 */
export async function uploadIdImage(file, { phone, tenantId } = {}) {
  if (!file) throw new Error("No file selected");
  const okTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (file.type && !okTypes.includes(file.type) && !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (JPG/PNG/WebP)");
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`Image too large — max ${MAX_FILE_MB}MB. Take a smaller photo or screenshot.`);
  }

  const phoneDigits = digitsOnly(phone) || "unknown";
  const tid = tenantId || `new-${Date.now().toString(36)}`;
  const path = `${phoneDigits}/${tid}-${Date.now()}-${sanitizeName(file.name)}`;

  // Offline / local-only mode → store as dataURL inside tenant record (works but bloats JSON)
  if (!isSupabaseConfigured || !supabase) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
    return { path: null, dataUrl, localOnly: true };
  }

  const { error } = await supabase.storage.from(ID_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message || "Upload failed");
  return { path, dataUrl: null, localOnly: false };
}

/** Resolve a viewable URL for a stored path (signed URL, refreshed each call). dataURLs pass through. */
export async function getIdImageUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (String(pathOrUrl).startsWith("data:")) return pathOrUrl;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl; // legacy absolute URL
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.storage
    .from(ID_BUCKET)
    .createSignedUrl(pathOrUrl, SIGNED_URL_SECONDS);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function deleteIdImage(path) {
  if (!path || String(path).startsWith("data:")) return true;
  if (!isSupabaseConfigured || !supabase) return true;
  const { error } = await supabase.storage.from(ID_BUCKET).remove([path]);
  if (error) return false;
  return true;
}

/** React hook: storage path/dataURL → viewable URL (handles signed-URL refresh). */
export function useIdImageUrl(pathOrUrl) {
  const [url, setUrl] = useState(
    pathOrUrl && String(pathOrUrl).startsWith("data:") ? pathOrUrl : null
  );
  useEffect(() => {
    let cancelled = false;
    if (!pathOrUrl) { setUrl(null); return; }
    if (String(pathOrUrl).startsWith("data:") || /^https?:\/\//.test(pathOrUrl)) {
      setUrl(pathOrUrl);
      return;
    }
    setUrl(null);
    getIdImageUrl(pathOrUrl).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [pathOrUrl]);
  return url;
}
