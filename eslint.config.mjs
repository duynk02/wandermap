import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow any during early development — tighten later
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars as warning, not error
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Allow require() in server-side-only files
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
];

export default eslintConfig;
