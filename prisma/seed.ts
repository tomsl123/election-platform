// Demo data for development: the United States of Free Cliffs, its parties and Cliffs, staff,
// a register of citizens, and demo elections. Runs only on an empty database. Never seed a real installation.
//
// Demo sign-ins (password for all: "free-cliffs-demo"):
//   escribez@usfc.test    platform administrator, owner of USFC
//   rootman@usfc.test     officer
//   norton@usfc.test      observer
// Demo e-mail is written to data/mailbox/ instead of being sent.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/crypto";
import { seedElections } from "./seed-elections";

const db = new PrismaClient();
const PASSWORD = "free-cliffs-demo";

const PARTIES = [
  { name: "Union of People's Synarchist Front", abbr: "UPSF", color: "#c22a2a", symbol: "star" },
  { name: "Conservative Unity Party", abbr: "CUP", color: "#2456a6", symbol: "tower" },
  { name: "Cliffs Assemble", abbr: "CA", color: "#d99a12", symbol: "sun" },
  { name: "Pevnou RuKou K AutoKracii RusKých Fízlů", abbr: "KKKK", color: "#2f7d55", symbol: "bolt" },
  { name: "PLUS Movement", abbr: "PLUS", color: "#6c4fa3", symbol: "flame" },
  { name: "Wall of Wisdom", abbr: "WoW", color: "#7a5a3a", symbol: "book" },
];

const CLIFFS = [
  ["Reliberated Cliff", "REL"],
  ["Eternal Sand Cliff", "SAND"],
  ["Snowbelle Cliff", "SNOW"],
  ["Dead End Cliff", "DEAD"],
  ["Normalcy Cliff", "NORM"],
  ["Bolivar's Cliff", "BOL"],
  ["Revolutionary Cliff", "REV"],
  ["Crimson Heights Cliff", "CRIM"],
  ["Holy Crusade Cliff", "HOLY"],
  ["Outer Fields", "OUT"],
  ["Former Union Cliff", "FUC"],
  ["Azure Blue Cliff", "AZUR"],
];

const CITIZENS = ["Builderswartz", "Revolucionez", "Planovsky", "Simons", "Salzburg", "Predkozkyn", "Harper", "Cheap", "Gorgonzola", "Naran", "Munkhbold", "Tudlenudle"];

async function main() {
  if ((await db.user.count()) > 0) {
    console.log("The database is not empty; the demo seed only runs on an empty database.");
    return;
  }
  const passwordHash = await hashPassword(PASSWORD);
  const owner = await db.user.create({ data: { email: "escribez@usfc.test", displayName: "President Escribez", passwordHash, isPlatformAdmin: true } });
  const officer = await db.user.create({ data: { email: "rootman@usfc.test", displayName: "Chairwoman Rootman", passwordHash } });
  const observer = await db.user.create({ data: { email: "norton@usfc.test", displayName: "Senator Norton", passwordHash } });

  const org = await db.organisation.create({
    data: {
      slug: "usfc",
      name: "United States of Free Cliffs",
      shortName: "USFC",
      timezone: "Europe/Prague",
      smtp: JSON.stringify({ enabled: true, transport: "file", fromName: "USFC Electoral Commission", fromAddress: "commission@usfc.test" }),
      brand: JSON.stringify({ words: { "certify.by": "President Escribez" } }),
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: officer.id, role: "OFFICER" },
          { userId: observer.id, role: "OBSERVER" },
        ],
      },
    },
  });

  for (const [i, p] of PARTIES.entries()) await db.party.create({ data: { ...p, orgId: org.id, position: i } });
  const set = await db.districtSet.create({ data: { orgId: org.id, name: "Cliffs" } });
  const districts = [];
  for (const [i, [name, code]] of CLIFFS.entries()) districts.push(await db.district.create({ data: { setId: set.id, name, code, seats: 50, position: i } }));

  for (const [i, name] of CITIZENS.entries()) {
    const email = `${name.toLowerCase()}@usfc.test`;
    const d = districts[i % districts.length];
    await db.registerEntry.create({
      data: { orgId: org.id, displayName: name, email, emailKey: email, districts: { create: { setId: set.id, districtId: d.id } } },
    });
  }

  await seedElections(db, org.id, owner.id);
  console.log(`Seeded USFC. Sign in as escribez@usfc.test with "${PASSWORD}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
