// Local dev server that runs the same Lambda handler on http://localhost:8787
//   npm run dev-server           → mock AI (no AWS needed)
//   BEDROCK_MODEL_ID=... AWS_REGION=us-east-1 node backend/dev-server.mjs  → real Bedrock
//                                  (needs the AWS SDK installed and AWS credentials)

import http from "node:http";

if (!process.env.BEDROCK_MODEL_ID && !process.env.AI_MODE) process.env.AI_MODE = "mock";
const { handler } = await import("./lambda/index.mjs");

const PORT = Number(process.env.PORT || 8787);

http
  .createServer(async (req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.url !== "/analyze") {
      res.writeHead(404, cors).end();
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20000) break;
    }
    const out = await handler({ requestContext: { http: { method: req.method } }, body });
    res.writeHead(out.statusCode, { ...out.headers, ...cors }).end(out.body);
    // Log only the outcome, never the posting text.
    if (req.method === "POST") {
      try {
        const parsed = JSON.parse(out.body);
        console.log(`${new Date().toISOString()} ${out.statusCode} ai=${parsed.ai?.risk ?? "none"} age=${parsed.domainAgeDays ?? "?"}`);
      } catch {
        console.log(`${new Date().toISOString()} ${out.statusCode}`);
      }
    }
  })
  .listen(PORT, () => {
    console.log(`JobGuard dev backend on http://localhost:${PORT}/analyze (AI: ${process.env.AI_MODE === "mock" ? "mock" : process.env.BEDROCK_MODEL_ID})`);
  });
