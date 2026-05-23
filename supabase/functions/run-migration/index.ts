import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://tplkmtmuoyslmjewcudk.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async () => {
  const { error } = await supabase.rpc("exec_migration", {
    sql: "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS apollo_id text;"
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
