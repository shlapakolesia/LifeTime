import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
const db = new PrismaClient();
if (process.env.NODE_ENV === "production") throw new Error("Local seed forbidden in production");
async function main() {
  const fixtures = [
    ["olesia", "Олеся", "Шлапак"],
    ["sofia", "Софія", "Садовенко"],
    ["solomia", "Соломія", "Шевченко"],
    ["andrii", "Андрій", "Коваленко"],
    ["admin", "Адміністратор", "LifeTime"],
  ];
  const users = [];
  for (const [key, firstName, lastName] of fixtures) {
    const email = `${key}@lifetime.local`;
    users.push(
      await db.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          subject: `local:${email}`,
          accountRole: key === "admin" ? "admin" : "user",
          premiumStatus: key === "admin" ? "premium" : "free",
          profile: {
            create: {
              firstName,
              lastName,
              timezone: "Europe/Kyiv",
              activeStart: "08:00",
              activeEnd: "21:00",
            },
          },
        },
      }),
    );
  }
  const [me, sofia, solomia, andrii] = users;
  await db.friendship.createMany({
    data: [sofia, solomia].flatMap((u) => [
      { ownerId: me.id, friendId: u.id },
      { ownerId: u.id, friendId: me.id },
    ]),
    skipDuplicates: true,
  });
  // Stable IDs and create-only upserts make repeated runs non-destructive.
  const tomorrow = DateTime.now().setZone("Europe/Kyiv").plus({ days: 1 }).startOf("day");
  for (const [index, user] of [me, sofia, solomia].entries()) {
    const eventId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    await db.calendarEvent.upsert({
      where: { id: eventId },
      update: {},
      create: {
        id: eventId,
        ownerId: user.id,
        title: ["Лекція з баз даних", "Командна зустріч", "Практична робота"][index],
        timezone: "Europe/Kyiv",
        startsAt: tomorrow.set({ hour: 9 + index }).toJSDate(),
        endsAt: tomorrow.set({ hour: 11 + index }).toJSDate(),
        privacy: "private",
        category: "Навчання",
      },
    });
  }
  await db.task.upsert({
    where: { id: "00000000-0000-4000-8000-000000000010" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000010",
      ownerId: me.id,
      title: "Підготувати звіт",
      deadline: tomorrow.plus({ days: 2 }).toJSDate(),
      estimatedMinutes: 60,
      scheduledStart: tomorrow.set({ hour: 15 }).toJSDate(),
      scheduledEnd: tomorrow.set({ hour: 16 }).toJSDate(),
    },
  });
  await db.group.upsert({
    where: { id: "00000000-0000-4000-8000-000000000020" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000020",
      ownerId: me.id,
      name: "Команда LifeTime",
      description: "Університетський проєкт",
      members: { create: [me, sofia, solomia].map((u) => ({ userId: u.id })) },
    },
  });
  if (!(await db.friendRequest.findFirst({ where: { senderId: andrii.id, recipientId: me.id } })))
    await db.friendRequest.create({ data: { senderId: andrii.id, recipientId: me.id } });
  console.log("Local users ready: " + users.map((u) => u.email).join(", "));
}
main().finally(() => db.$disconnect());
