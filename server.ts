import { createQwikCity } from "@builder.io/qwik-city/middleware/node";
import qwikCityPlan from "@qwik-city-plan";
import render from "./src/entry.ssr";
import { createServer } from "node:http";

const { router, notFound } = createQwikCity({ render, qwikCityPlan });

const PORT = parseInt(process.env.PORT || "8080", 10);

const server = createServer((req, res) => {
  router(req, res, () => {
    notFound(req, res, () => {
      res.writeHead(404);
      // tsserver bug: fails to resolve inherited end() from stream.Writable;
      // tsc --noEmit compiles this correctly.
      (res as any).end();
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
