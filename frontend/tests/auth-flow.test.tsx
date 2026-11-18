import { beforeAll, afterAll, afterEach, test, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../../backend/src/app";
import { db } from "../../backend/src/services/database";
import App from "../src/App";

const databaseTest = process.env.RUN_DB_TESTS === "true" ? test : test.skip;
let server: Server;
const nativeFetch = globalThis.fetch;
const observed: { path: string; status: number }[] = [];
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp(undefined, {
      name: "integration-contract",
      async interpret({ text, timezone, history }) {
        if (text.startsWith("Коли я вільна 18 листопада"))
          return { type: "availability", startDate: "2026-11-18", endDate: "2026-11-18" };
        if (text === "Додай завдання")
          return { type: "clarification", message: "Яка назва завдання?" };
        const alternate = text === "О 18:00";
        if (alternate) {
          expect(history?.some((turn) => turn.role === "user" && turn.text === scheduling)).toBe(true);
          expect(history?.at(-1)?.text).toBe("На який інший час запланувати цю подію?");
        }
        return {
          type: "proposal",
          message: "Перевір подію.",
          proposal: { kind: "event", data: {
            title: "Зустріч з Олесею",
            startsAt: alternate ? "2026-11-18T16:00:00Z" : "2026-11-18T13:00:00Z",
            endsAt: alternate ? "2026-11-18T17:00:00Z" : "2026-11-18T16:00:00Z",
            timezone,
          } },
        };
      },
    }).listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server unavailable");
  globalThis.fetch = async (input, init) => {
    const original = new URL(String(input));
    const response = await nativeFetch(
      `http://127.0.0.1:${address.port}${original.pathname}${original.search}`,
      init,
    );
    observed.push({ path: original.pathname, status: response.status });
    return response;
  };
  window.scrollTo = () => {};
  HTMLElement.prototype.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
afterAll(async () => {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.$disconnect();
});

databaseTest(
  "new registration → onboarding → real Dashboard → refresh → logout → existing login",
  async () => {
    const email = `onboarding-${randomUUID()}@lifetime.local`;
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    sessionStorage.clear();
    history.replaceState({}, "", "/register");
    const interaction = userEvent.setup();
    const view = render(<App />);
    await screen.findByRole("heading", { name: "Створити акаунт" });
    await interaction.type(screen.getByLabelText("Ім’я"), "Марія");
    await interaction.type(screen.getByLabelText("Прізвище"), "Тестова");
    await interaction.type(screen.getByLabelText("Email"), email);
    await interaction.click(screen.getByRole("button", { name: "Зареєструватися" }));
    for (let i = 0; i < 4; i++)
      await interaction.click(screen.getByRole("button", { name: "Продовжити" }));
    expect(screen.getByRole("heading", { name: "Коли твій активний час?" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Від"), { target: { value: "10:15" } });
    fireEvent.change(screen.getByLabelText("До"), { target: { value: "19:45" } });
    await interaction.click(screen.getByRole("button", { name: "Відкрити LifeTime" }));
    await screen.findByRole("heading", { name: "Привіт, Марія." });
    expect(location.pathname).toBe("/dashboard");
    const stored = JSON.parse(sessionStorage.getItem("lifetime:auth-session")!);
    const persisted = await db.user.findUniqueOrThrow({
      where: { email },
      include: { profile: true },
    });
    expect(stored.identity.id).toBe(persisted.id);
    expect(persisted.accountRole).toBe("user");
    expect(persisted.premiumStatus).toBe("free");
    expect(persisted.profile?.activeStart).toBe("10:15");
    expect(persisted.profile?.activeEnd).toBe("19:45");
    expect(persisted.profile?.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const token = stored.token;
    // Tear down the entire React tree, retain only browser session storage as a refresh does.
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "Привіт, Марія." });
    expect(location.pathname).toBe("/dashboard");
    expect(JSON.parse(sessionStorage.getItem("lifetime:auth-session")!).identity.id).toBe(
      persisted.id,
    );
    expect(observed.some((r) => r.path === "/api/dev-auth/register" && r.status === 201)).toBe(
      true,
    );
    const restored = await nativeFetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/profile`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect((await restored.json()).id).toBe(persisted.id);
    await interaction.click(screen.getAllByRole("button", { name: "Налаштування" })[0]);
    await interaction.click(await screen.findByRole("button", { name: "Вийти" }));
    await screen.findByRole("heading", { name: /Знаходь час/ });
    expect(sessionStorage.getItem("lifetime:auth-session")).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Увійти", exact: true }));
    await interaction.type(screen.getByLabelText("Email"), email);
    await interaction.click(screen.getByRole("button", { name: "Увійти", exact: true }));
    await screen.findByRole("heading", { name: "Привіт, Марія." });
    expect(JSON.parse(sessionStorage.getItem("lifetime:auth-session")!).identity.id).toBe(
      persisted.id,
    );
    expect(
      (await db.userProfile.findUniqueOrThrow({ where: { userId: persisted.id } })).activeStart,
    ).toBe("10:15");
  },
);

databaseTest("failed login stays on form with a Ukrainian error and no session", async () => {
  sessionStorage.clear();
  history.replaceState({}, "", "/login");
  render(<App />);
  await screen.findByRole("heading", { name: "Увійти в LifeTime" });
  const interaction = userEvent.setup();
  await interaction.type(screen.getByLabelText("Email"), `missing-${randomUUID()}@lifetime.local`);
  await interaction.click(screen.getByRole("button", { name: "Увійти", exact: true }));
  await screen.findByText("Локальний акаунт не знайдено. Перевірте email або зареєструйтеся.");
  expect(location.pathname).toBe("/login");
  expect(sessionStorage.getItem("lifetime:auth-session")).toBeNull();
});

databaseTest(
  "duplicate registration stays in onboarding, explains failure and preserves existing user",
  async () => {
    const email = `duplicate-${randomUUID()}@lifetime.local`;
    const original = await db.user.create({
      data: {
        email,
        subject: `local:${email}`,
        profile: {
          create: {
            firstName: "Оригінал",
            lastName: "Акаунт",
            activeStart: "07:00",
            activeEnd: "18:00",
          },
        },
      },
    });
    sessionStorage.clear();
    history.replaceState({}, "", "/register");
    render(<App />);
    const interaction = userEvent.setup();
    await screen.findByRole("heading", { name: "Створити акаунт" });
    await interaction.type(screen.getByLabelText("Ім’я"), "Нове");
    await interaction.type(screen.getByLabelText("Прізвище"), "Ім’я");
    await interaction.type(screen.getByLabelText("Email"), email);
    await interaction.click(screen.getByRole("button", { name: "Зареєструватися" }));
    for (let i = 0; i < 4; i++)
      await interaction.click(screen.getByRole("button", { name: "Продовжити" }));
    await interaction.click(screen.getByRole("button", { name: "Відкрити LifeTime" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Акаунт із цією email-адресою вже існує",
    );
    expect(location.pathname).toBe("/register");
    expect(sessionStorage.getItem("lifetime:auth-session")).toBeNull();
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: original.id } });
    expect(profile.firstName).toBe("Оригінал");
    expect(profile.activeStart).toBe("07:00");
  },
);

databaseTest("calendar overlap warning supports cancel, reschedule, confirmation and refresh", async () => {
  const email = `overlap-${randomUUID()}@lifetime.local`;
  const user = await db.user.create({
    data: {
      email,
      subject: `local:${email}`,
      profile: { create: { firstName: "Марія", lastName: "Календар" } },
    },
  });
  const count = () => db.calendarEvent.count({ where: { ownerId: user.id } });
  sessionStorage.clear();
  history.replaceState({}, "", "/login");
  const page = render(<App />);
  const interaction = userEvent.setup();
  await interaction.type(await screen.findByLabelText("Email"), email);
  await interaction.click(screen.getByRole("button", { name: "Увійти", exact: true }));
  await screen.findByRole("heading", { name: "Привіт, Марія." });
  await interaction.click(screen.getAllByRole("button", { name: "Календар", exact: true })[0]);

  const open = async (title: string, start: string, end: string) => {
    await interaction.click(screen.getByRole("button", { name: "Додати подію" }));
    await interaction.type(screen.getByLabelText("Назва"), title);
    fireEvent.change(screen.getByLabelText("Початок"), { target: { value: start } });
    fireEvent.change(screen.getByLabelText("Кінець"), { target: { value: end } });
    await interaction.click(screen.getByRole("button", { name: "Створити подію" }));
  };
  const conflict = () => screen.findByRole("dialog", { name: "Накладка в календарі" });

  await open("Лекція", "14:00", "16:00");
  await screen.findByRole("button", { name: /Лекція.*14:00/ });
  await open("Зустріч з Олесею", "15:00", "18:00");
  await conflict();
  await interaction.click(screen.getByRole("button", { name: "Скасувати", exact: true }));
  expect(await count()).toBe(1);
  expect(screen.queryByRole("dialog")).toBeNull();

  await open("Зустріч з Олесею", "15:00", "18:00");
  await conflict();
  await interaction.click(screen.getByRole("button", { name: "Обрати інший час" }));
  expect(screen.getByRole("dialog", { name: "Нова подія" })).toBeTruthy();
  expect((screen.getByLabelText("Початок") as HTMLInputElement).value).toBe("15:00");
  await interaction.click(screen.getByRole("button", { name: "Створити подію" }));
  await conflict();
  const confirm = screen.getByRole("button", { name: "Створити попри накладку" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByRole("button", { name: /Зустріч з Олесею.*15:00/ });
  expect(await count()).toBe(2);

  page.unmount();
  render(<App />);
  await screen.findByRole("button", { name: /Лекція.*14:00/ });
  await interaction.click(await screen.findByRole("button", { name: /Зустріч з Олесею.*15:00/ }));
  fireEvent.change(screen.getByLabelText("Початок"), { target: { value: "14:30" } });
  await interaction.click(screen.getByRole("button", { name: "Зберегти", exact: true }));
  await conflict();
  await interaction.click(screen.getByRole("button", { name: "Зберегти попри накладку" }));
  await screen.findByRole("button", { name: /Зустріч з Олесею.*14:30/ });
  expect(await count()).toBe(2);
});

const scheduling = "Заплануй зустріч з Олесею 18 листопада о 15:00 на 3 години";

async function openPremiumAssistant() {
  const email = `assistant-${randomUUID()}@lifetime.local`;
  const user = await db.user.create({
    data: {
      email,
      subject: `local:${email}`,
      premiumStatus: "premium",
      profile: { create: {
        firstName: "Марія", lastName: "Календар",
        timezone: "Europe/Kyiv", activeStart: "09:00", activeEnd: "20:00",
      } },
    },
  });
  await db.calendarEvent.create({
    data: {
      ownerId: user.id, title: "Лекція",
      startsAt: new Date("2026-11-18T12:00:00Z"), endsAt: new Date("2026-11-18T14:00:00Z"),
      timezone: "Europe/Kyiv",
    },
  });
  const count = () => db.calendarEvent.count({ where: { ownerId: user.id } });
  sessionStorage.clear();
  history.replaceState({}, "", "/login");
  render(<App />);
  const interaction = userEvent.setup();
  await interaction.type(await screen.findByLabelText("Email"), email);
  await interaction.click(screen.getByRole("button", { name: "Увійти", exact: true }));
  await screen.findByRole("heading", { name: "Привіт, Марія." });
  await interaction.click(screen.getAllByRole("button", { name: "AI-помічник", exact: true })[0]);
  const ask = async (text: string) => {
    await interaction.type(screen.getByPlaceholderText("Запитай про свій розклад…"), text);
    await interaction.click(screen.getByRole("button", { name: "Надіслати" }));
  };

  return { ask, count, interaction };
}

databaseTest("Premium assistant shows real availability and only saves an overlap after confirmation", async () => {
  const { ask, count, interaction } = await openPremiumAssistant();
  await ask("Коли я вільна 18 листопада 2026?");
  await screen.findByText("18 листопада 2026: 09:00–14:00, 16:00–20:00.");
  await ask(scheduling);
  await interaction.click(await screen.findByRole("button", { name: "Обрати інший час" }));
  await ask("О 18:00");
  await screen.findByRole("button", { name: "Підтвердити й створити" });
  await interaction.click(screen.getByRole("button", { name: "Скасувати", exact: true }));
  expect(await count()).toBe(1);

  await ask(scheduling);
  const confirm = await screen.findByRole("button", { name: "Створити попри накладку" });
  expect(await count()).toBe(1);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText(/подію «Зустріч з Олесею» створено/);
  expect(await count()).toBe(2);
});

for (const [query, reply] of [
  ["Коли я вільна 18 листопада?", "18 листопада 2026: 09:00–14:00, 16:00–20:00."],
  ["Додай завдання", "Яка назва завдання?"],
]) {
  databaseTest(`AI clears an unrelated pending proposal after: ${query}`, async () => {
    const { ask, count } = await openPremiumAssistant();
    await ask(scheduling);
    await screen.findByRole("button", { name: "Створити попри накладку" });
    await ask(query);
    await screen.findByText(reply);
    expect(screen.queryByRole("button", { name: "Створити попри накладку" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Підтвердити й створити" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Обрати інший час" })).toBeNull();
    expect(await count()).toBe(1);
  });
}

databaseTest("AI reports a successful write separately from a failed refresh", async () => {
  const { ask, count, interaction } = await openPremiumAssistant();
  await ask(scheduling);
  const confirm = await screen.findByRole("button", { name: "Створити попри накладку" });
  const fetchApi = globalThis.fetch;
  let confirmations = 0;
  let refreshFailures = 0;
  let created = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/api/ai/proposals/confirm") {
      confirmations++;
      const response = await fetchApi(input, init);
      created = response.status === 201;
      return response;
    }
    if (created && pathname === "/api/events") {
      refreshFailures++;
      return Response.json({ message: "Помилка читання календаря." }, { status: 503 });
    }
    return fetchApi(input, init);
  });

  await interaction.click(confirm);
  await screen.findByText("Готово: подію «Зустріч з Олесею» створено.");
  await screen.findByText("Не вдалося оновити календар. Онови сторінку, щоб побачити зміни.");
  expect(screen.queryByText("Помилка читання календаря.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Створити попри накладку" })).toBeNull();
  expect(await count()).toBe(2);
  expect(confirmations).toBe(1);
  expect(refreshFailures).toBe(1);
});
