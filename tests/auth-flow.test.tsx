import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../backend/src/app";
import { db } from "../backend/src/services/database";
import App from "../src/App";

const databaseTest = process.env.RUN_DB_TESTS === "true" ? test : test.skip;
let server: Server;
const nativeFetch = globalThis.fetch;
const observed: { path: string; status: number }[] = [];
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
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
});
afterEach(() => cleanup());
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
