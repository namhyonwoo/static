/**
 * citizen-sim TURN 자격증명 발급 Worker (Cloudflare Workers, 무료 플랜으로 충분)
 *
 * 역할: Cloudflare Realtime TURN 키로 짧은 수명의 자격증명을 만들어 페이지에 돌려준다.
 *       TURN 키 API 토큰은 이 Worker의 비밀 변수에만 두고, 브라우저에는 절대 보내지 않는다.
 *
 * 설정 (Cloudflare 대시보드):
 *   1. Realtime → TURN Server → Create TURN key  →  "TURN Key ID"와 "API Token"을 받는다.
 *   2. Workers & Pages → Create → Worker → 이 파일 내용을 붙여 넣고 Deploy.
 *   3. Worker 설정 → Variables and Secrets 에 아래 두 개를 Secret 으로 추가:
 *        TURN_KEY_ID        = (TURN Key ID)
 *        TURN_KEY_API_TOKEN = (API Token)
 *      선택: ALLOW_ORIGIN = https://namhyonwoo.github.io  (기본값은 아래 상수)
 *   4. Worker 주소(예: https://citizen-turn.<계정>.workers.dev)를 index.html 의 TURN_ENDPOINT 에 넣는다.
 */
const DEFAULT_ALLOW = ["https://namhyonwoo.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const TTL_SECONDS = 6 * 60 * 60;   // 자격증명 유효 시간. 페이지는 만료 전에 새로고침하면 새로 받는다.

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allow = env.ALLOW_ORIGIN ? env.ALLOW_ORIGIN.split(",").map(s => s.trim()) : DEFAULT_ALLOW;
    const cors = {
      "Access-Control-Allow-Origin": allow.includes(origin) ? origin : allow[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response(JSON.stringify({ error: "GET only" }), { status: 405, headers: cors });
    if (!allow.includes(origin) && origin) return new Response(JSON.stringify({ error: "origin not allowed" }), { status: 403, headers: cors });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return new Response(JSON.stringify({ error: "TURN secrets not set" }), { status: 500, headers: cors });

    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!r.ok) return new Response(JSON.stringify({ error: "cloudflare " + r.status }), { status: 502, headers: cors });
    const data = await r.json();
    // 브라우저가 막는 53번 포트 주소는 걸러 준다
    const iceServers = (data.iceServers || []).map(s => ({
      ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => !/:53(\?|$)/.test(u)),
    })).filter(s => s.urls.length);
    return new Response(JSON.stringify({ iceServers, ttl: TTL_SECONDS }), { status: 200, headers: cors });
  },
};
