import https from "node:https";
import { lookup } from "node:dns/promises";
import { setTimeout as sleep } from "node:timers/promises";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { officialUrl } from "./sources.mjs";

const agent = "UICTO-Knowledge-Indexer";
const limit = 512 * 1024;

export function publicAddress(address) {
  const ip = ipaddr.process(address);
  return (
    ip.range() === "unicast" &&
    (ip.kind() !== "ipv6" || ip.match(ipaddr.parse("2000::"), 3))
  );
}

// Resolve once per connection and use those same public addresses for TLS.
function pinnedLookup(host, options, callback) {
  lookup(host, { all: true })
    .then((records) => {
      if (!records.length || records.some((r) => !publicAddress(r.address)))
        throw Error("Non-public address");
      if (options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    })
    .catch((err) => callback(err));
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: false,
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent": agent + "/1.0",
          Accept: "text/plain,text/html",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const parts = [];
        let bytes = 0;
        res.on("error", reject);
        res.on("data", (part) => {
          bytes += part.length;
          if (bytes > limit) req.destroy(Error("Response too large"));
          else parts.push(part);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(parts).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
  });
}

export function officialClient(get = request, pause = sleep) {
  const policies = new Map();
  let calls = 0;
  async function load(url, delay = 1000) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (++calls > 24) throw Error("Fetch budget exhausted");
      await pause(delay * (attempt + 1));
      let response;
      try {
        response = await get(url);
      } catch {
        if (attempt) throw Error("Website unavailable");
        continue;
      }
      if (
        [502, 503, 504].includes(response.status) &&
        !response.headers["retry-after"] &&
        !attempt
      )
        continue;
      return response;
    }
    throw Error("Website unavailable");
  }
  async function policy(origin) {
    if (!policies.has(origin)) {
      const url = origin + "/robots.txt";
      const r = await load(url);
      if (
        r.status !== 200 ||
        !/^text\/plain\b/i.test(r.headers["content-type"] ?? "")
      )
        throw Error("Robots policy unavailable");
      const robots = robotsParser(url, r.body);
      let users = [],
        directives = false,
        grantsInput = false;
      const signals = r.body
        .split(/\r?\n/)
        .map((line) => line.split("#")[0].trim())
        .filter((line) => {
          const group = line.match(/^user-agent:\s*(\S+)/i);
          if (group) {
            if (directives) users = [];
            users.push(group[1].toLowerCase());
            directives = false;
          } else if (line) directives = true;
          if (!/^content-signal:/i.test(line)) return false;
          if (
            users.some((u) => u === "*" || agent.toLowerCase() === u) &&
            /\bai-input=yes\b/i.test(line)
          )
            grantsInput = true;
          return true;
        })
        .join(" ");
      policies.set(origin, {
        robots,
        referenceOnly:
          !grantsInput ||
          /ai-input=no|use=reference|use=immediate/i.test(signals),
        searchDenied: /search=no/i.test(signals),
      });
    }
    return policies.get(origin);
  }
  async function page(input, use = "reference") {
    let url = officialUrl(input);
    for (let hops = 0; hops < 4; hops++) {
      if (!url || url.endsWith(".pdf")) throw Error("Unapproved HTML URL");
      const p = await policy(new URL(url).origin);
      const delay = Math.max(1, p.robots.getCrawlDelay(agent) || 0);
      if (
        delay > 10 ||
        p.searchDenied ||
        p.robots.isAllowed(url, agent) !== true ||
        (use === "rag" && p.referenceOnly)
      )
        throw Error("Website policy does not permit this use");
      const r = await load(url, delay * 1000);
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        url = r.headers.location && officialUrl(r.headers.location, url);
        continue;
      }
      if (
        r.status !== 200 ||
        !/^text\/html\b/i.test(r.headers["content-type"] ?? "") ||
        r.headers["cf-mitigated"] === "challenge" ||
        /<title>\s*(just a moment|access denied)/i.test(
          r.body,
        )
      )
        throw Error("Unavailable or restricted page (HTTP " + r.status + ")");
      return { url, html: r.body };
    }
    throw Error("Redirect limit exceeded");
  }
  return { page };
}
