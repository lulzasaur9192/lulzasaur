import postgres from "postgres";

async function main() {
  const sql = postgres("postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur", { max: 2 });

  const rows = await sql`
    SELECT agent_name, model, trigger, input_tokens, output_tokens, total_tokens, tool_calls, duration_ms, created_at 
    FROM token_usage_log 
    ORDER BY created_at DESC 
    LIMIT 30
  `;

  console.log("agent_name | model | trigger | input | output | total | tools | ms | time");
  console.log("-----------|-------|---------|-------|--------|-------|-------|----|-----");
  for (const r of rows) {
    const name = (r.agent_name || "?").toString().substring(0,22).padEnd(22);
    const model = (r.model || "?").toString().substring(0,24).padEnd(24);
    const trigger = (r.trigger || "?").toString().padEnd(10);
    console.log(`${name} | ${model} | ${trigger} | ${String(r.input_tokens).padStart(7)} | ${String(r.output_tokens).padStart(7)} | ${String(r.total_tokens).padStart(7)} | ${String(r.tool_calls).padStart(5)} | ${String(r.duration_ms).padStart(8)} | ${r.created_at?.toISOString?.() || r.created_at}`);
  }

  await sql.end();
}
main();
