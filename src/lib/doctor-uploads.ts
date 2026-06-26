// Upload helpers for doctor documents.
//
// Files live in the private `doctors` bucket under a per-user folder:
//
//   doctors/{user_id}/profile/selfie.jpg
//   doctors/{user_id}/verification/license.<ext>
//   doctors/{user_id}/verification/nysc.<ext>
//
// Only the doctor (matching auth.uid()) and admins can read these
// objects (RLS on storage.objects).
//
// After a successful upload we ALWAYS:
//  1. Persist the new storage path on the doctor's profile row so admin
//     review surfaces the latest document.
//  2. Remove the previous stored file if its path differs (e.g. a new
//     file extension), so admins never see stale uploads.
//  3. If the doctor is in `action_required`, flip verification back to
//     `pending` so both sides reflect "Pending Approval".

import { supabase } from "@/integrations/supabase/client";

const BUCKET = "doctors";

function extFor(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()! : "";
  const safe = fromName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (safe) return safe;
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return file.type.split("/")[1] ?? "bin";
  return "bin";
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

async function uploadAt(path: string, body: Blob, contentType: string): Promise<string> {
  // One retry on transient errors (mobile network blips, brief 5xx). The
  // second attempt waits 1.5 s, then we surface the error to the caller so
  // the user is not forced to reshoot / re-pick on a single bad packet.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType,
    });
    if (!error) return path;
    lastErr = error;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Upload failed");
}

async function getProfileField(
  uid: string,
  field: "selfie_url" | "license_name" | "nysc_name",
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(field)
    .eq("id", uid)
    .maybeSingle();
  if (error) return null;
  return (data as Record<string, string | null> | null)?.[field] ?? null;
}

async function setProfileField(
  uid: string,
  field: "selfie_url" | "license_name" | "nysc_name",
  value: string,
): Promise<void> {
  const patch: Partial<{
    selfie_url: string;
    license_name: string;
    nysc_name: string;
  }> = { [field]: value };
  const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
  if (error) throw error;
}

async function removeStaleObject(prev: string | null, next: string): Promise<void> {
  if (!prev || prev === next) return;
  if (/^https?:\/\//i.test(prev)) return; // legacy URL, leave alone
  try {
    await supabase.storage.from(BUCKET).remove([prev]);
  } catch (e) {
    console.warn("removeStaleObject failed", e);
  }
}

async function autoResubmitIfActionRequired(): Promise<void> {
  try {
    const { doctorResubmitVerification } = await import("@/lib/profile-remote");
    await doctorResubmitVerification();
  } catch (e) {
    console.warn("auto-resubmit verification failed", e);
  }
}

/** Upload the doctor's selfie (dataURL from the camera capture).
 *  Returns the storage path stored on `profiles.selfie_url`. */
export async function uploadDoctorSelfie(dataUrl: string): Promise<string> {
  const uid = await currentUserId();
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const path = `${uid}/profile/selfie.jpg`;
  const prev = await getProfileField(uid, "selfie_url");
  const out = await uploadAt(path, blob, blob.type || "image/jpeg");
  await setProfileField(uid, "selfie_url", out);
  await removeStaleObject(prev, out);
  await autoResubmitIfActionRequired();
  return out;
}

export type DoctorDocKind = "license" | "nysc";

/** Upload a verification document. Returns the storage path. */
export async function uploadDoctorDocument(
  kind: DoctorDocKind,
  file: File,
): Promise<string> {
  const uid = await currentUserId();
  const path = `${uid}/verification/${kind}.${extFor(file)}`;
  const field = kind === "license" ? "license_name" : "nysc_name";
  const prev = await getProfileField(uid, field);
  const out = await uploadAt(path, file, file.type || "application/octet-stream");
  await setProfileField(uid, field, out);
  await removeStaleObject(prev, out);
  await autoResubmitIfActionRequired();
  return out;
}
