export const dynamic = "force-static";

const election = { $ref: "#/components/schemas/Election" };
const orgParam = { name: "org", in: "path", required: true, schema: { type: "string" }, example: "usfc" };
const slugParam = { name: "slug", in: "path", required: true, schema: { type: "string" }, example: "federal-polling-day" };

const spec = {
  openapi: "3.1.0",
  info: { title: "Polling Station API", version: "1", description: "Public data needs no key. A read key (Bearer ps_…) also lists drafts; a manage key may open and close polls. Keys are made under Office → Settings." },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { key: { type: "http", scheme: "bearer" } },
    schemas: {
      Election: {
        type: "object",
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "NOMINATIONS", "READY", "OPEN", "CLOSED", "COUNTED", "CERTIFIED", "CANCELLED"] },
          access: { type: "string", enum: ["PUBLIC", "INVITE"] },
          transparency: { type: "string", enum: ["SECRET", "WHO_VOTED", "SHOW_OF_HANDS"] },
          resultsMode: { type: "string", enum: ["SEALED", "LIVE"] },
          opensAt: { type: ["string", "null"], format: "date-time" },
          closesAt: { type: ["string", "null"], format: "date-time" },
          round: { type: "integer" },
          resultHash: { type: ["string", "null"] },
        },
      },
    },
  },
  paths: {
    "/orgs/{org}/elections": { get: { summary: "List elections", parameters: [orgParam], responses: { 200: { description: "Elections", content: { "application/json": { schema: { type: "object", properties: { elections: { type: "array", items: election } } } } } } } } },
    "/orgs/{org}/elections/{slug}": { get: { summary: "One election with its papers and options", parameters: [orgParam, slugParam], responses: { 200: { description: "Election" }, 404: { description: "Not found" } } } },
    "/orgs/{org}/elections/{slug}/turnout": { get: { summary: "How many have voted", parameters: [orgParam, slugParam], responses: { 200: { description: "Turnout" }, 403: { description: "Hidden while open" } } } },
    "/orgs/{org}/elections/{slug}/results": { get: { summary: "The sealed count, or the live tally when results are live", parameters: [orgParam, slugParam], responses: { 200: { description: "Result" }, 404: { description: "Sealed" } } } },
    "/orgs/{org}/elections/{slug}/ballots": { get: { summary: "The chained ballots after the count, for recounting (redirects to the download)", parameters: [orgParam, slugParam], responses: { 302: { description: "Download" }, 404: { description: "Not counted" } } } },
    "/orgs/{org}/elections/{slug}/stream": { get: { summary: "Server-sent events: one `changed` event whenever the election changes", parameters: [orgParam, slugParam], responses: { 200: { description: "text/event-stream" } } } },
    "/orgs/{org}/elections/{slug}/open": { post: { summary: "Open the polls", security: [{ key: [] }], parameters: [orgParam, slugParam], responses: { 200: { description: "Opened" }, 409: { description: "Cannot open (reason given)" } } } },
    "/orgs/{org}/elections/{slug}/close": { post: { summary: "Close the polls and count", security: [{ key: [] }], parameters: [orgParam, slugParam], responses: { 200: { description: "Closed" }, 409: { description: "Cannot close" } } } },
  },
  "x-webhooks": {
    description: "Registered under Office → Settings. POST with JSON {event, at, data}; header X-PS-Signature: sha256=<HMAC-SHA256 of the raw body with the webhook's secret>; X-PS-Event names the event.",
    events: ["election.opened", "election.closed", "election.counted", "election.certified", "envelope.held"],
  },
};

export function GET() {
  return Response.json(spec);
}
