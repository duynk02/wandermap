import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { zodResolver } from "@hookform/resolvers/zod";

// Next resolves extensionless TypeScript imports; match that resolution in this Node test.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { loginSchema, registerSchema, createPostSchema, updateProfileSchema } = await import("../src/lib/validations/index.ts");
const { managedMediaPath } = await import("../src/lib/api/media.ts");
hooks.deregister();

test("patched Zod/resolver preserve Vietnamese auth/profile errors and parsed form output", async () => {
  const resolver = zodResolver(loginSchema);
  const rejected = await resolver({ email: "invalid", password: "" }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.equal(rejected.errors.email.message, "Email không hợp lệ");
  assert.equal(rejected.errors.password.message, "Vui lòng nhập mật khẩu");
  assert.equal(registerSchema.safeParse({ email: "a@example.com", password: "short", username: "abc", display_name: "A" }).success, false);
  const profile = updateProfileSchema.parse({ username: "  traveler  ", display_name: "  Du khách  ", bio: "", home_city: "" });
  assert.equal(profile.username, "traveler");
  assert.equal(profile.display_name, "Du khách");
  assert.equal(createPostSchema.safeParse({ images: Array(11).fill("https://example.com/image.webp") }).success, false);
});

test("managed image routes strip the origin and never forward credentials or query tokens", () => {
  const route = "/api/v1/media/11111111-1111-4111-8111-111111111111";
  assert.equal(managedMediaPath(`https://api.example.com${route}`), route.slice(7));
  assert.equal(managedMediaPath(`https://api.example.com${route}?token=secret`), null);
  assert.equal(managedMediaPath("https://cdn.example.com/photo.webp"), null);
});
