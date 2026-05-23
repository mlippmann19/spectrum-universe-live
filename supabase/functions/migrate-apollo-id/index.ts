/**
 * One-shot migration: adds apollo_id column to contacts table.
 * Call once via: POST https://tplkmtmuoyslmjewcudk.supabase.co/functions/v1/migrate-apollo-id
 * with header: Authorization: Bearer <service_role_key>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://tplkmtmuoyslmjewcudk.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

Deno.serve(async () => {
  try {
    // Run ALTER TABLE directly via the postgres connection the edge runtime has
    const { data, error } = await supabase.rpc("pg_migrate_apollo_id");
    if (error) {
      // RPC doesn't exist yet — fall through to raw approach
      // Try using the auth admin API to run raw SQL isn't available
      // Return what we know
      return new Response(JSON.stringify({ rpc_error: error.message, hint: "Create the pg_migrate_apollo_id RPC or run SQL manually" }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
