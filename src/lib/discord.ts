// Discord delivery through incoming webhooks. Only genuine Discord webhook URLs
// are accepted, so this can never be pointed at an internal address.

const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export function isDiscordWebhook(url: string): boolean {
  return WEBHOOK.test(url.trim());
}

export type DiscordMessage = {
  content?: string;
  username?: string;
  embeds?: Array<{
    title: string;
    description?: string;
    url?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
  allowed_mentions?: { parse: string[]; roles?: string[]; users?: string[] };
};

export const DISCORD_COLORS = { brass: 0xc9a14a, curtain: 0x2d5a3e, red: 0xa8261e, blue: 0x2456a6, ink: 0x23201c };

export async function postDiscord(webhookUrl: string, message: DiscordMessage): Promise<void> {
  const url = webhookUrl.trim();
  if (!isDiscordWebhook(url)) throw new Error("That is not a Discord webhook address.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Discord answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}
