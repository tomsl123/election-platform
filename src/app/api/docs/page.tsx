import "../../office.css";
import { Shell } from "@/components/office/Shell";
import { Sheet } from "@/components/office/ui";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "API" };
export const dynamic = "force-dynamic";

// The API described in the office's own look (no third-party Swagger bundle: the CSP forbids it).
export default async function ApiDocs() {
  const s = await getSettings();
  const base = `${s.site.baseUrl.replace(/\/+$/, "")}/api/v1`;
  const rows: Array<[string, string, string]> = [
    ["GET", "/orgs/{org}/elections", "Every election that is not a draft (a read key also sees drafts)."],
    ["GET", "/orgs/{org}/elections/{slug}", "One election with its papers and approved options."],
    ["GET", "/orgs/{org}/elections/{slug}/turnout", "How many have voted; hidden while open unless turnout is shown or you hold a key."],
    ["GET", "/orgs/{org}/elections/{slug}/results", "The sealed count (with its hash and seal), or the live tally; 404 while sealed."],
    ["GET", "/orgs/{org}/elections/{slug}/ballots", "After the count: the chained ballots to recount yourself."],
    ["GET", "/orgs/{org}/elections/{slug}/stream", "Server-sent events: `changed` whenever anything changes."],
    ["POST", "/orgs/{org}/elections/{slug}/open", "Manage key: open the polls."],
    ["POST", "/orgs/{org}/elections/{slug}/close", "Manage key: close the polls and count."],
  ];
  return (
    <Shell title={s.site.name} subtitle="API, version 1">
      <Sheet title="The API" lede={`Base address ${base}. JSON in, JSON out; CORS is open for reading.`}>
        <table className="ledger">
          <tbody>
            {rows.map(([m, p, d]) => (
              <tr key={m + p}>
                <td className="mono small">{m}</td>
                <td className="mono small">{p}</td>
                <td className="small">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr className="rule" />
        <h3>Examples</h3>
        <pre className="mono small" style={{ whiteSpace: "pre-wrap", background: "#efe7d3", padding: 12 }}>
          {`curl ${base}/orgs/usfc/elections
curl ${base}/orgs/usfc/elections/federal-polling-day/results
curl -X POST -H "Authorization: Bearer ps_…" ${base}/orgs/usfc/elections/federal-polling-day/close`}
        </pre>
        <hr className="rule" />
        <h3>Webhooks</h3>
        <p className="small">
          Registered under Office → Settings. Each event is a POST of <code>{`{ "event", "at", "data" }`}</code> with the header <code>X-PS-Signature: sha256=…</code>, the HMAC-SHA256 of the raw body with the webhook&apos;s secret. Events: election.opened, election.closed, election.counted, election.certified, envelope.held. Failed deliveries are retried after 1, 5, 15 and 60 minutes.
        </p>
        <p className="small">
          Machine-readable: <a href="/api/openapi.json">/api/openapi.json</a>
        </p>
      </Sheet>
    </Shell>
  );
}
