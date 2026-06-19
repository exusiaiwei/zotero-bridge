import http from "node:http";

const DEFAULT_PORT = 23119;
const ENDPOINT = "/cli-bridge/eval";

function getPort() {
  return parseInt(process.env.ZOTERO_PORT || DEFAULT_PORT, 10);
}

export function execute(code, { port, timeout = 30000 } = {}) {
  port ??= getPort();
  return new Promise((resolve, reject) => {
    const body = Buffer.from(code, "utf-8");
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": body.length,
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Zotero bridge timeout"));
    });
    req.on("error", (e) => {
      if (e.code === "ECONNREFUSED") {
        reject(new Error("Zotero is not running or JS Bridge plugin is not installed"));
      } else {
        reject(e);
      }
    });
    req.end(body);
  });
}

export async function ping(port) {
  try {
    const result = await execute('return "pong"', { port, timeout: 3000 });
    return result === "pong";
  } catch {
    return false;
  }
}
